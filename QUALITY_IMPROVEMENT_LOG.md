# Quality status

The quality programme raises the review score from 7.2 to above 9. The design is
[docs/superpowers/specs/2026-10-28-quality-above-nine-design.md](docs/superpowers/specs/2026-10-28-quality-above-nine-design.md);
each phase has a plan in [docs/superpowers/plans/](docs/superpowers/plans/).

## Scorecard

Re-scored after every phase from measurements; an area that misses its target says so.

| Area | Baseline (2026-10-27) | Now | Target |
|---|---:|---:|---:|
| Architecture & structure | 8 | 9 | 9 |
| Testing | 8 | 8 | 9.5 |
| UI code | 7.5 | 8 | 9 |
| Tooling & CI | 7.5 | 9 | 9.5 |
| Data integrity & reliability | 8 | 8 | 9 |
| Readability | 5.5 | 7 | 9 |
| Security & licensing | 7.5 | 7.5 | 9 |
| Performance | 7.5 | 7.5 | 9 |
| Docs & repo hygiene | 5 | 9 | 9 |
| **Average** | **7.2** | **8.1** | **9.1** |

Docs reached 9 in phase 1: tracked `docs/` fell from 19.5 MB to 2.4 MB with no raw logs (all
archived with checksums), the 1,368-line log became this page, `PRODUCT.md`, the licence server
README and the dev guide match the code, 7 untrue comments were fixed, and every relative link
in the living docs resolves.

Architecture reached 9 in phase 2: three Electron-era modules nothing reached (628 lines) are
gone, the architecture gate now rejects any runtime module no entry point reaches, and the module
map is in `docs/ARCHITECTURE.md`.

Tooling reached 9 in phase 3: Prettier formats the code and CI checks it; ESLint 10's flat config
lints every JavaScript file and the interface's TypeScript, with accessibility rules, and any
warning fails; the strict test gate enforces coverage limits (shared 88% of lines and branches,
backend 94% and 88%). Its last half point is the strict backend typecheck in CI (phase 4). UI code
rose to 8 with the TypeScript and accessibility linting. Readability rose to 6.5: code lines over
120 characters fell from 3,117 to 340, while the 50 over-complex functions wait for phase 4. The
gate also exposed a real bug, now fixed with tests: copying a file's timestamps could round its
millisecond stamp the other way, failing about one render or delivery copy in 20,000.

Readability rose to 7 in phase 4a: all 55 backend runtime files, and the shared modules they
import, now type-check with strict null checks in CI, up from 2. The 237 errors were fixed with
JSDoc types and explicit null checks, with no behaviour change. None was a genuine bug, but nine
documented types were stale or malformed and are now enforced. Implicit `any` and untyped catch
variables remain for phase 4d.

Phase 4b-1 split the 10 functions above complexity 20 in the contract runtime and the shared
modules (`runtime.js`, `overlay_render.js`, `psd_layers.js`, `proof_renderer.js`) into named
helpers, with no behaviour change; 63 of the 73 remain for batches 4b-2 to 4b-5 and phase 5. Before
each change, new tests pinned what it could move: exact limit issues and step counts, every schema
rejection, PSD text layers and unwritable PNGs, and the proof renderer's sharp calls and output
bytes. Each was mutation-checked. In the shared suite, `proof_renderer.js` coverage rose from 35%
to 94% of lines, and `psd_layers.js` from 90% to 99%. Each refactored function was then compared
with the original: 268,731 comparisons in all, mostly seeded random inputs plus the authored
examples and test fixtures, with the validators' 40,409 inputs run under the real limits and five
scaled ones. There were 0 differences, and each comparison caught deliberate mutants.
Splitting the renderer exposed a real bug, now fixed with a test: on a page with edited template
layers, a photo that couldn't be read moved every later photo into the previous frame's place in
the layer stack, under or over the wrong template art. Readability stays at 7 until more of the
63 fall.

Phase 4b-2 split the 16 functions above complexity 20 in the verified reads, publication and
locking code (`labnaming.js`, `publication_broker.js`, `verified_file.js`, `cache.js`,
`private_stage.js`, `project_lock.js`, `project_transaction.js`, `file_publication.js`,
`render_transaction.js`, `delivery_transaction.js`) into named helpers, with no behaviour change;
47 of the 63 remain for batches 4b-3 to 4b-5 and phase 5. These files protect customer data, so
each save or publication ran on the old and new code with every file-system call failing in turn,
failing from that call on, or with another writer's edit arriving just before it, comparing the
calls, the result or error, what recovery did and the files left: 27,638 runs over 34 scenarios,
with up to 834 calls per operation, plus 20,000 random or changed inputs to the journal and request
checks, with 0 differences. The broker is the exception: its saves make about 2,000 calls, mostly
lock and publication work this phase swept separately or didn't change, so its 2,052 of those runs
failed every call the broker makes itself, the first 20, the last 120 and every 25th between.
Deliberate mutants were caught in every task; one that marked a publication committed too early
survived the planned sweeps until a scenario edited the stage journal mid-run, and delivery was
cancelled at every position because its checks make no file-system calls. 32 new tests pinned the
failure paths, each mutation-checked; backend tests rose from 898 to 930, and
`publication_broker.js` coverage from 92% to 99% of lines. A late coverage check and the final
review found the report had counted branches no test reached inside large functions, which the
split exposed in `verified_file.js`, the project lock's failed reclamations and all three commit
markers. Those are now pinned, as is what a save reports when a directory sync fails just after its
move, and a random comparison of three predicates the plan had skipped found 0 differences in
90,000 inputs. The review also led to two real fixes, each with its own test: a publication mode
sent as an array such as `["new"]` passed validation and then behaved as `overwrite`, and a project
commit marker holding `null` gave a raw TypeError instead of the mismatch message. Readability
stays at 7 until more of the 47 fall.

Phase 4b-3 split the 16 functions above complexity 20 in the rendering, colour, PDF and proof code
(`preflight.js`, `render.js`, `deliver.js`, `color.js`, `pdf.js`, `proofs.js`, `parity.js`,
`psd_template.js`) into named helpers; 31 of the 47 remain for batches 4b-4, 4b-5 and phase 5. These
functions had less testing than the last batch, so each was pinned first, using exact branch marks
on a copy of the old code: tests reached 1,255 of their 1,814 branch outcomes before and 1,796 now.
The 18 left can't be reached, because an earlier check or the way a value is read rules them out.
Backend tests rose from 930 to 2,030, and backend coverage from 95.5% to 96.6% of lines and from
89.3% to 92.2% of branches. Of 1,265 mutants of the 16 functions that change an operator or a value,
1,243 were caught; the other 22 are equivalent code, dead writes or the unreachable outcomes above. A
30-second limit first counted timed-out mutants as caught, which hid two real survivors in
`runExport` until the limit rose to 120 seconds. Those two now have a test, and the other 8 timeouts,
rerun on the old code, are real hangs.

Each split was then compared with the original, with 0 differences: 756,000 random or changed
inputs, including 6,000 whole albums through preflight; 44 authored `psdPixels` cases; 75,987 runs
of the render, export and proof jobs with each collaborator call failing, cancelled or answering
differently; and 4,382 runs with each file-system call failing once or from then on. Of 192 sampled
mutants of the new code, 180 were caught by the comparison they were aimed at and 9 by another; the
last 3 are an unreachable branch and a dead write. The sweeps never reach a developed photo, a font
edit, a turned photo, a bad selection or a proof refresh, so those paths rest on the collaborator
comparisons and the pins. No moved per-pixel loop slowed by more than 3.6%. Pinning also found two
faults, each fixed after the unchanged split in its own commit with a test that failed first, though
no user could have met either. The blank-page proof path couldn't lay photos on, failing with 'Input
buffer contains unsupported image format', but real template art always has a backdrop, so that path
only runs when a test stubs `templateArt`. A photo unreadable from memory was skipped with the note
's.split is not a function'; the note now says it couldn't be read, but nothing in the interface
shows these notes, and it still doesn't name the photo.

The final review found no change in behaviour, and 1,500,000 more random inputs showed 0 differences,
but it did show the pins were weaker than these numbers suggest. A harder mutator, which drops an
`await`, swaps neighbouring statements or deletes one, made 1,909 mutants of the eight files: 561
passed the pin files, and of 66 mutants run on the whole suite, 8 of them written by hand, 62 still
passed. Fakes of asynchronous work answered at once, so a dropped `await` changed nothing a row could
see, and a row that breaks one rule can't show which of two checks runs first. One fix pass made
those fakes take a turn, as the real calls do, and added 45 tests: albums and files that break two
rules at once, integrity checks that only the comparisons had been guarding, and how a proof is
saved. Of the 62, 53 now fail a test. The other 9 swap neighbouring statements that don't depend
on each other, except one that matters only if the engine's reply has no layer list. Five more hand
mutants, first run on the whole suite in this pass, also pass it: none changes anything a user could
see, short of a project file edited by hand. Testing stays at 8, because its target needs the
component, accessibility and rule tests of phase 5, and Readability stays at 7 until more of the 31
fall.

## Phases

| Phase | Status |
|---|---|
| 0. Commit Codex's work | Done 2026-10-28 |
| 1. Docs and repo hygiene | Done 2026-10-28 |
| 2. Architecture | Done 2026-10-28 |
| 3. Tooling | Done 2026-10-29 |
| 4a. Null-checked types | Done 2026-10-29 |
| 4b-1. Contract runtime and shared modules | Done 2026-10-29 |
| 4b-2. Verified reads, publication and locking | Done 2026-10-30 |
| 4b-3. Rendering, colour, PDF and proofs | Done 2026-10-31 |
| 4b-4, 4b-5, 4c, 4d, 5–7 | Not started |

## Open items

- Phase 4: Codex's code added 26 long lines and two over-complex functions (`requestOf`,
  `validateExpectation`); the 10,000-entry message names the wrong operation in some paths;
  render recovery lists `.album-studio` without an entry bound.
- Phase 4: 18 errors thrown from catch blocks carry no cause (`eslint-suppressions.json`).
  `serializeError` copies recovery metadata from the cause chain, so each site needs its own
  decision and test. ESLint 10 counts two more complex functions than ESLint 8 did
  (`psd_template.js`, `project_lock.js`) with no code changed. `native/ui/spike.html` is a
  leftover shell feasibility page.
- Phase 4 (from 4a): four copies of one ag-psd canvas shim (`parity.js`, `preflight.js`,
  `psd_template.js`, `template_check.js`); `finishPrivateStage`'s `onRetired` option, which
  nothing passes; and three explicit `any` types for 4d to narrow (`makeCache`'s result,
  `onConflict`'s conflict, the overlay list).
- Phase 4 (from 4b-1): the proof renderer's pinning tests hash the JPEG bytes sharp writes on
  macOS with Apple silicon (CI's platform), so another runner, or a sharp update such as
  Dependabot's weekly ones, needs new pins taken before any renderer change. On an edited-template
  page, two frames with the same name share one slot, so one of their photos is lost; flattened
  pages draw both (this predates 4b-1). `contrastStage` applies clarity, and
  `matchesArray`/`matchesObject` return false or nothing where `matchesCombinator` returns a
  boolean; clearer names would help.
- Phase 4 (from 4b-2): four modules repeat one transaction skeleton of prepare, journal, capture,
  install, commit and recover (`project_transaction.js`, `file_publication.js`,
  `render_transaction.js`, `delivery_transaction.js`); merging them is a design change, not a
  split. When `cache.js` can't examine a moved snapshot, its retention report still names the
  original path (pinned as today's behaviour). The `recovery.renderCommitted` and
  `recovery.publicationCommitted` checks in the failure paths matter only if a commit marker
  appears between two reads, and no test reaches them. Node's coverage report, and lcov with it,
  can count an unreached branch in a large function as covered, so batches 4b-3 on choose pins with
  marked copies and give every extracted predicate a random comparison. A sweep proves old against
  new, so a branch only a sweep reaches still needs a test.
- Phase 4 (from 4b-3): in `templateArt`, 'The template changed while its cached backdrop was
  checked' is thrown inside a `try` whose `catch` swallows it, so the code falls through to a full
  decode, which verifies. `applyFrameEdit` writes `f.hidden` and `f.opacity`, which are recomputed
  for every frame straight after, so nothing reads them. In `frozenPhotos`, `ph.original ||
  ph.thumb` never reads `ph.thumb`, because a `sourceKey` only comes with an original. The `lstat`
  test in `exportFailed` is always true, because both of its outcomes answer true. A proof's
  `skipped` notes reach the `proofs.updated` event and stop there, and they don't name the photo.
  Later batches count a timed-out mutant as caught only if it's a real hang, run the review's
  dropped-`await`, swap and delete mutants beside the operator ones, and make a fake take a turn
  whenever the real call does.
- CI: the engine pin at `5301ba3` holds on GitHub as well as locally. Run 41062213208 on `3c0ac25`
  passed all three jobs, including the native workspace job that had failed on all three earlier
  finished runs of this branch. Run 41076354641 on `13b90ce`, the first on `Album-Studio-2.0`,
  passed all three as well, so the six commits after `3c0ac25` are covered. That run was started by
  hand after Actions was turned on. Run 41099409111 on `2449d75` was started by the push and passed
  all three jobs, so pushes now start CI there:
  [docs/quality/ENGINE_PIN_AND_CI.md](docs/quality/ENGINE_PIN_AND_CI.md).
- Phase 5: five accessibility findings in three controls lack keyboard operation: the
  Inspector's photo rows, the spread's frame hit areas and the frame-adjust overlay
  (`eslint-suppressions.json`). Coverage limits rise from 88/88 (shared) and 94/88 (backend).
- Phase 6: the broker accepts `project.json` as a target without the project lease;
  `replacesSource` is misnamed; hard-link aliases are untested.
- Phase 7: lock histories, `inputs/` and orphan stages grow without bound; opening an album runs
  four settled checks per spread.
- Production requirements still open: [docs/quality/RECOVERY_AND_VERIFICATION.md](docs/quality/RECOVERY_AND_VERIFICATION.md).

## History

- The full log of earlier iterations (to 2026-10-19) and Codex's scorecard:
  [docs/quality/archive/](docs/quality/archive/).
- Raw evidence moved out of git: [docs/quality/ARCHIVE.md](docs/quality/ARCHIVE.md).
- Recovery and verification guidance: [docs/quality/RECOVERY_AND_VERIFICATION.md](docs/quality/RECOVERY_AND_VERIFICATION.md).
