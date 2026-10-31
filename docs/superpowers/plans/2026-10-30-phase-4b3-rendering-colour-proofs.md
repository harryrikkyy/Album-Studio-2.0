# Phase 4b-3: Simplify rendering, colour, PDF and proofs, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the 16 functions above complexity 20 in the backend's rendering, colour, PDF and proof code down to 20 or less, with no behaviour change. This is the third of phase 4b's five batches.

**Architecture:** Each function is split into named helpers and predicates in its own module, as in 4b-1 and 4b-2. These functions are less tested than the last batch: 559 of their 1,814 branch outcomes have no test. So each function first gets table-driven pins, chosen from exact branch marks, until every reachable outcome runs and scripted mutants of the function fail. Only then is it split. Old and new are then compared on seeded random inputs (parsers), the fault sweep (file code) or a new collaborator sweep (the job orchestrators).

**Tech Stack:** Node 22, `node:test`, the repository's ESLint 10 complexity rule, espree for the marking and mutation tools, and the 4b-2 tools `compare.mjs`, `sweep.mjs`, `complexity.mjs` and `fn-complexity.mjs`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-28-quality-above-nine-design.md` (phase 4, item 4b).

## Global Constraints

- Repo `/Volumes/Harry/works/albumStudio-photocraft`, branch `codex/album-quality-improvement`. It maps onto the public repo's `main`. Push only when the user asks, with `git push` or `git push origin codex/album-quality-improvement:main`, fast-forward only; never `git push origin HEAD`. Don't amend or rewrite anything at or before `2449d75`.
- `R=/Volumes/Harry/works/albumStudio-photocraft`. `S=/private/tmp/claude-501/-Volumes-Harry-works-albumStudio-photocraft/2821a411-2a3f-4a06-90c0-a3e281d60cf7/scratchpad/phase4b`. `E=$R/.superpowers/evidence/phase-4b3` holds the scripts and logs (git-ignored, already created, because scratch is volatile). Copies of the code live in `$S`, so a reboot loses only what `git archive` can rebuild.
- This shell is zsh: `status` is read-only, `echo ======` fails, expand lists with `${=F}`, use `/usr/bin/grep` for complex patterns and quote `--include` globs. `gh` and `timeout` aren't installed. Foreground `sleep` is blocked. An `rm` on a shell-variable path is written `"${M:?}"/*.txt`.
- Backend tests need the engine: `BIN="$R/native/dist/Album Studio Latest.app/Contents/Resources/bin"; export ALBUM_STUDIO_PHOTOCRAFT_CLI="$BIN/photocraft-cli" ALBUM_STUDIO_RENAME_CLI="$BIN/album-studio-rename-exclusive"`.
- Gate before every commit, through `$E/scripts/commit.sh` (Task 1), which commits only on seven `ok` lines. The backend Poppler test is the only allowed failure. If an unrelated test times out under load, re-run it alone, then re-run the gate.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Prettier sets the layout. New lines stay within 120 characters.
- Never restore a file with uncommitted changes from git. Mutation and fault checks run on separate copies.
- Nothing is permanently deleted, and Firebase production is never touched.
- Spec 4b, verbatim: "Refactor every runtime function above complexity 20 (48 today) to 20 or less by extracting named helpers and predicates. Each extracted pure predicate is compared with the original on random inputs; every refactored file runs the full backend suite."
- Spec, line 189, verbatim: "Each new test is mutation-checked: break the code it protects and confirm it fails."
- No behaviour change: identical return values, thrown errors (message, code, recovery fields), issue order, file-system and collaborator calls in the same order with the same arguments, the same files left on disk, the same events, and the same output bytes. The null-checked typecheck stays at zero errors. Extra microtask ticks and error stack text are outside "behaviour".
- A bug found while pinning or splitting is fixed only in its own commit after the unchanged refactor, with a test that fails first.

### Rulings

Each ruling has its cost if wrong.

1. **The batch is these 16 functions** (measured 2026-10-30 on `2449d75`; 47 functions above 20 remain repo-wide, so 31 should remain after this batch). "Marks" counts branch outcomes in the base code, from `$E/logs/marks-base.txt`.

   | Module:line | Function | Complexity | Lines | Marks hit |
   |---|---|---:|---:|---:|
   | `preflight.js:51` | `preflightAlbum` | 156 | 402 | 314/409 |
   | `pdf.js:52` | `jpegInfo` | 61 | 101 | 110/142 |
   | `render.js:170` | `runJob` | 58 | 271 | 104/143 |
   | `deliver.js:335` | `runExport` | 47 | 197 | 77/104 |
   | `color.js:85` | `compositeMetadata` | 46 | 102 | 92/135 |
   | `proofs.js:648` | `prepareRefresh` | 43 | 101 | 88/112 |
   | `proofs.js:313` | `drawProof`'s `draw` arrow | 42 | 129 | 72/119 |
   | `parity.js:79` | `applyLayerEdits` | 37 | 92 | 46/97 |
   | `color.js:563` | `decodeCmykComposite` | 36 | 84 | 74/102 |
   | `color.js:706` | `psdPixels` | 36 | 80 | 60/79 |
   | `psd_template.js:125` | `shapeAlpha` | 32 | 41 | 23/72 |
   | `psd_template.js:271` | `templateArt`'s job arrow | 30 | 102 | 51/69 |
   | `color.js:189` | `compositePlanes` | 28 | 73 | 48/62 |
   | `color.js:317` | `validateProfile` | 25 | 49 | 37/57 |
   | `parity.js:185` | `addOverlays` | 25 | 77 | 33/61 |
   | `psd_template.js:84` | `collectFrames` | 22 | 39 | 26/51 |

   Cost if wrong: none; the list is measured.
2. **One method for every function:**
   - (a) Pin: add table-driven tests until the marks report shows no unhit outcome for the function, apart from Ruling 4's list.
   - (b) Prove the pins: run scripted mutants of the function against them. Each survivor gets a new row or a stated reason in `$E/logs/survivors.md`.
   - (c) Commit the pins, separately and first.
   - (d) Split into named helpers and predicates in the same module, keeping the signature.
   - (e) Compare old and new with the task's tool, and prove the comparison with sampled mutants.
   - (f) Check that the function and every new helper are at 20 or less, and timing where a hot loop moved.
   - (g) Re-record the readability baseline, run the gate, commit.

   Cost if wrong: none; each step is a check.
3. **Pins come from exact marks, not from coverage.** V8 coverage reads 77–99% of lines for these eight modules while 31% of the branch outcomes inside these functions never run, so the report hides what matters. `mark.mjs` rewrites a copy of each module so each outcome records itself. Done means each outcome ran, not that each line ran. Cost if wrong: none; marks are stricter than coverage.
4. **These 16 outcomes can't be reached, and are the only ones a function may leave unhit:**
   - `compositeMetadata:87` (`!isSafeInteger(at)`, `!isSafeInteger(size)`, `at < 0`, `size < 0`): each value comes from an unsigned read of a bounds-checked buffer.
   - `compositeMetadata:105` (`!isSafeInteger(decodedBytes)`): at most 300,000 × 300,000 × 56 × 4.
   - `decodeCmykComposite:565` (the same four operands) and `:583` (`!isSafeInteger(expected)`): the same reasons.
   - `jpegInfo:93` (`!frameIds`): set in the same step as `frame`, which is tested first.
   - `psdPixels:715` (`buf.length >= 26` false, `'8BPS'` false): `compositeMetadata` has already validated both.
   - `runExport:467` (`stage` false) and `:468` (the `lstat` result false): `stage` is set before the transaction owns it, and `.then(() => true, () => true)` is always true. The `lstat` call stays, because it's a file-system call in order.
   - `preflightAlbum:294` (`by < ay` true): an opaque pixel sets `bx` and `by` together.

   Another outcome joins this list only with a stated reason in the ledger. Cost if wrong: a dead branch goes unpinned, which can't change behaviour.
5. **Tests reach private functions through a new test helper, `native/backend/test/load_private.js`.** It compiles a fresh copy of a module, optionally exposing private functions and replacing what the module requires. A scratch trial on `render.js` and `parity.js` showed that it reaches `runJob`, replaces collaborators the module destructures at load, and leaves the coverage report working. Production code gains no test-only export. Cost if wrong: a test exercises a copy compiled apart from the app's module; it's the same file, and the existing real-engine tests still run the real one.
6. **Three comparison tools, by the kind of function:**
   - Pure functions and predicates: `compare.mjs`, seeded, with structure-aware generators that break one rule per input (about 85%) or none, plus a run breaking two rules at once to check which error wins.
   - File-system code: `sweep.mjs` from 4b-2 (`templateArt`'s job, `draw`, `psdPixels`, `preflightAlbum`).
   - Orchestrators: a new collaborator sweep, `collab.mjs` (`runJob`, `runExport`, `prepareRefresh`, `draw`). `applyLayerEdits` and `addOverlays` take a fake `pc` through `compareAsync`.

   Each comparison must catch sampled mutants of the new code. Cost if wrong: a scenario that never reaches a branch hides a difference; running each sweep with the marked copy as "old" shows what it reached.
7. **Mutation runs at scale through `mutate.mjs`, not by hand.** This batch adds about 300 rows, so hand-breaking each is impractical. The script negates each condition, swaps each `&&`/`||`, moves each comparison boundary, drops each `!` and removes each `continue` and `break` in the function, on separate copies. Cost if wrong: a survivor analysed as equivalent wasn't; the sweep still compares old and new there.
8. **Hot loops stay single loops inside one helper, with no per-pixel function calls.** `opaqueBounds` is expected at about 16. `timing.mjs` compares old and new on a 3600×2400 input; new must be within 10% of old. Cost if wrong: slower proofs, caught by that check.
9. **Helpers stay in their module.** The two near-identical CMYK and RGB resource scans differ in bounds and messages, so they aren't merged. The three `need` closures do become one `boundsCheck(buf, error)`, since they differ only in the error. Cost if wrong: some duplication stays.
10. **Preflight tests use a stubbed decoder only where a real PSD can't produce the input.** `ag-psd`'s `readPsd` is a writable export reached by property lookup, so `t.mock.method(ag, 'readPsd', …)` works without changing production code. Cost if wrong: such a row pins today's code on a tree ag-psd wouldn't return, which is harmless for a refactor.
11. **Two oddities stay, because this phase changes no behaviour.** In `templateArt`, 'The template changed while its cached backdrop was checked' is thrown inside a `try` whose `catch` swallows it, so the code falls through to a full decode, which verifies. The `continue` at the end of `runExport`'s retire loop does nothing. Both go in the log's open items in Task 12. Cost if wrong: none.
12. **One batch, one fresh reviewer, tasks in order of risk.** Each task commits on its own, so the user can stop after any task. Parsers come first, because they're pure; then file code; then the three orchestrators, which handle a customer's committed work. The stale CI sentence in the log is corrected in Task 12. Cost if wrong: a long review; the Review Focus directs it.
13. **The stacking-slot pin from 4b-1's review is Task 2.** The log asks for it before this batch. Cost if wrong: none.
14. **The readability baseline is re-recorded once per task,** after its complexity findings fall. Cost if wrong: none.

## Measuring

- **Marks.** `$E/scripts/marks.sh <test files>` copies the tests into `$S/marked-4b3` (base code, marked), runs the named files there and writes `$E/logs/marks-now.txt`.
- **Mutants.** `$E/scripts/mutants.sh <name> <file> <line> <test files>` writes the survivors to `$E/logs/mutants-<name>.txt`.
- **Complexity.** From the repo root, `node $E/scripts/complexity.mjs > $E/logs/complexity.tsv` lists every function above 20, and `node $E/scripts/fn-complexity.mjs <file>` gives every function in one file.
- **Old against new.** The old version is `$S/base-4b3`, a `git archive` of this plan's base commit with `node_modules` symlinked (Task 1).
- **Timing.** `node $E/scripts/timing.mjs` (Task 1), extended by the tasks that move a hot loop.

## Review Focus

1. **What one bad spread does to the rest of a job.** A failure in a spread's own work is reported for that spread and the job carries on; a failure before that work starts ends the job; a cancel ends it cleanly and says so. Today `ownedSheetRecord` runs outside the per-spread `try`, so a helper that moves it inside would turn a job failure into a spread failure. Test: Task 10's `a sheet-record failure ends the job` and `a failed spread doesn't stop the next one`, and Task 11's `a failed sheet ends the export`.
2. **Preflight says the same things in the same order.** A user fixes problems from the top of this list, and its order follows the code's order across spreads, orientations and frames. Test: Task 8's `one album breaking many rules reports them in order`, which asserts the full list of codes for two spreads.
3. **A damaged file gets the same message, never a raw TypeError.** When two things are wrong, the first check wins; a reordered helper changes which message the user reads. Test: Task 3's and Task 4's `first failure wins` rows, and each comparison's two-rule run.
4. **What the user is told after a commit.** Once a sheet or delivery is saved, a later failure must say the work is saved and must not claim it failed or was restored. Test: Task 10's `a failure after commit reports the saved sheet` and Task 11's `a committed delivery with a recovery failure reports both`.
5. **The pixels and the speed don't change.** A proof, mask or decoded composite must stay byte-identical, and these loops run for every pixel of a print sheet. Test: Task 4's `decoded samples keep their bytes`, Task 6's `mask bytes`, Task 9's `proof bytes` rows, and `timing.mjs`.

---

### Task 1: The base checkout, the test loader and the tools

**Files:**
- Create: `native/backend/test/load_private.js`, `native/backend/test/load_private.test.js`
- Create (git-ignored): `$S/base-4b3/`, `$S/marked-4b3/`, `$E/scripts/{collab,mutate,timing}.mjs`, `$E/scripts/{marks,mutants,commit}.sh`, `$E/logs/survivors.md`
- Modify (git-ignored): `$E/scripts/compare.mjs`, `$E/scripts/mark-report.mjs`

**Interfaces:**
- Produces: `loadPrivate(file, { names, stubs }) → exports`, with `exports.__private` holding `names`. `file` is a path relative to `native/backend/test`, such as `'../lib/render.js'`. `stubs` maps a module's `require` id to the object it receives.
- Produces: `expose(root, file, names, stubs) → private functions` and `compareAsync(name, oldFn, newFn, inputs) → Promise<number>` in `compare.mjs`.
- Produces: `collab(spec) → Promise<number>` and `recorded(name, fn)` in `collab.mjs`, where `spec` is `{ name, file, names, roots: { old, new }, real, errors, scenarios, run, flip? }`.
- Produces: `marks.sh`, `mutants.sh` (with `MUT_ALSO`, `MUT_CMD`, `MUT_SAMPLE` and `MUT_LIMIT`) and `commit.sh` as used in every later task.

- [ ] **Step 1: Base and marked copies**

```bash
cd /Volumes/Harry/works/albumStudio-photocraft && BASE=$(git rev-parse HEAD) && echo "$BASE" > $E/logs/base.sha
mkdir -p $S/base-4b3 && git archive "$BASE" | tar -x -C $S/base-4b3
ln -s $R/node_modules $S/base-4b3/node_modules && ln -s $R/native/ui/node_modules $S/base-4b3/native/ui/node_modules
```

Record `BASE` in the ledger. `$S/marked-4b3` already exists on `2449d75` with the eight modules marked, and `$S/marks-4b3` holds the full suite's hits. If `BASE` isn't `2449d75`, or a reboot lost them, rebuild both: archive `BASE` to `$S/marked-4b3`, symlink `node_modules`, run `node $E/scripts/mark.mjs native/backend/lib/<module>.js $S/marks-4b3` from its root for each of `preflight pdf render deliver color proofs parity psd_template`, then run the full backend suite there with the engine variables.

- [ ] **Step 2: Report against the base, not the repo**

In `$E/scripts/mark-report.mjs`, line 23 reads the function spans from the repo, whose lines move once a task splits a function. Change it to read from `$S/base-4b3`:

```js
const original = path.join(process.env.BASE_ROOT, file)
```

- [ ] **Step 3: Write the failing test for the loader**

`native/backend/test/load_private.test.js`:

```js
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { loadPrivate } = require('./load_private')

test('a private function comes back under __private', () => {
  const { __private } = loadPrivate('../lib/parity.js', { names: ['agBox'] })
  assert.deepEqual(__private.agBox({ left: 1, top: 2, right: 5, bottom: 6 }), { x: 1, y: 2, w: 4, h: 4 })
})

test('a stub replaces a collaborator the module destructures at load', async () => {
  const calls = []
  const { __private } = loadPrivate('../lib/deliver.js', {
    names: ['runExport'],
    stubs: {
      fs: {
        promises: {
          mkdir: async () => {
            calls.push('mkdir')
            throw new Error('no folder')
          },
        },
      },
      './jobs': { ...require('../lib/jobs'), releaseJob: async () => calls.push('release') },
    },
  })
  const job = { id: 'j', total: 0, done: 0, skipped: 0, failed: 0, cancelled: false, finishingErrors: [] }
  const prepared = { p: {}, plan: { spreads: [] }, cache: { spreads: {} }, spreads: [], want: {}, s: {}, paths: { sheets: '/x' } }
  await __private.runExport(job, prepared, () => {})
  assert.deepEqual(calls, ['mkdir', 'release'])
  assert.equal(job.failed, 1)
})

test('each load is a fresh copy', () => {
  const a = loadPrivate('../lib/parity.js', { names: ['agBox'] })
  const b = loadPrivate('../lib/parity.js', { names: ['agBox'] })
  assert.notEqual(a.__private.agBox, b.__private.agBox)
})
```

Run: `cd $R/native/backend && node --test test/load_private.test.js`
Expected: FAIL with "Cannot find module './load_private'".

- [ ] **Step 4: Write the loader**

`native/backend/test/load_private.js`:

```js
'use strict'

// Loads a fresh copy of a backend module for a test. `names` lists private functions to expose as
// `exports.__private`, and `stubs` replaces what the module requires, including the collaborators
// it destructures at load, which a mock of the real module's export can't reach.

const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')

function loadPrivate(file, { names = [], stubs = {} } = {}) {
  const filename = require.resolve(file)
  const copy = new Module(filename, module)
  copy.filename = filename
  copy.paths = Module._nodeModulePaths(path.dirname(filename))
  copy.require = function (id) {
    return Object.hasOwn(stubs, id) ? stubs[id] : Module.prototype.require.call(this, id)
  }
  const tail = names.length ? `\nmodule.exports.__private = { ${names.join(', ')} }\n` : ''
  copy._compile(fs.readFileSync(filename, 'utf8') + tail, filename)
  return copy.exports
}

module.exports = { loadPrivate }
```

Run: `cd $R/native/backend && node --test test/load_private.test.js`
Expected: PASS, 3 of 3.

- [ ] **Step 5: Add `expose` and `compareAsync`**

Add these imports at the top of `$E/scripts/compare.mjs`, then append the rest:

```js
import fs from 'node:fs'
import Module from 'node:module'
import path from 'node:path'
```

```js
// One version's private functions, with what the module requires optionally replaced.
export function expose(root, file, names, stubs = {}) {
  const filename = path.join(root, file)
  const copy = new Module(filename)
  copy.filename = filename
  copy.paths = Module._nodeModulePaths(path.dirname(filename))
  copy.require = function (id) {
    return Object.hasOwn(stubs, id) ? stubs[id] : Module.prototype.require.call(this, id)
  }
  copy._compile(`${fs.readFileSync(filename, 'utf8')}\nmodule.exports.__private = { ${names.join(', ')} }\n`, filename)
  return copy.exports.__private
}
const runAsync = async (fn, args) => {
  try {
    return { value: await fn(...args) }
  } catch (error) {
    return { error: { name: error.name, message: error.message, code: error.code } }
  }
}
export async function compareAsync(name, oldFn, newFn, inputs) {
  let differences = 0
  for (const makeArgs of inputs) {
    const a = await runAsync(oldFn, makeArgs()),
      b = await runAsync(newFn, makeArgs())
    if (!isDeepStrictEqual(a, b) && differences++ < 3) console.log(name, a, b)
  }
  console.log(`${name}: ${inputs.length} inputs, ${differences} differences`)
  return differences
}
```

`inputs` here are functions that build fresh arguments, so a fake's log and any mutated object aren't shared between versions.

Every comparison script in this plan follows three rules, so a mutant run can drive it. The new version's root is `process.env.CMP_NEW || R`. `process.env.CMP_ONLY`, when set, limits it to the comparisons whose name contains that text. It exits 1 on any difference.

- [ ] **Step 6: Write `$E/scripts/collab.mjs`**

```js
// Old-versus-new sweep for orchestrators. Each version loads its own copy of the target with every
// collaborator replaced by a recording fake, so a run takes a millisecond or two and no engine runs.
// The clean run of each scenario counts its calls. Then each call N in turn throws each scripted
// error, sees the job cancelled just before it, or returns a flipped answer.
import fs from 'node:fs'
import Module from 'node:module'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'

let run = null // { log, at, fault, scenario, ctx, flip }

function show(value, depth = 0) {
  if (typeof value === 'function') return 'function'
  if (typeof value === 'string')
    return value.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z\b/g, '<iso>')
  if (value instanceof Error) {
    const fields = Object.entries(value).map(([k, v]) => [k, show(v, depth + 1)])
    return { error: value.message, ...Object.fromEntries(fields) }
  }
  if (value instanceof Map || value instanceof Set) return [...value].map((v) => show(v, depth + 1))
  if (Buffer.isBuffer(value)) return `bytes:${value.length}`
  if (!value || typeof value !== 'object' || depth > 6) return value
  if (Array.isArray(value)) return value.map((v) => show(v, depth + 1))
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, show(v, depth + 1)]))
}

// One call: logged, then faulted if this is call N. Returns whether to flip the answer.
function called(name, args) {
  const n = run.at++
  run.log.push([name, show(args)])
  const fault = run.fault
  if (!fault || fault.at !== n) return false
  if (fault.kind === 'cancel') run.ctx.cancel()
  if (fault.kind === 'throw') throw fault.make()
  return fault.kind === 'flip'
}

function answer(name, self, args) {
  const fn = run.scenario.answers[name]
  if (!fn) {
    // The target may catch this as a spread's failure, so once() reports it afterwards.
    run.missing = name
    throw new Error(`no answer for ${name}`)
  }
  return fn.apply(self, [args, run.ctx])
}

// A fake keeps its function's kind, so a synchronous throw stays synchronous.
export function recorded(name, real) {
  if (real && real.constructor.name === 'AsyncFunction')
    return async function (...args) {
      const flip = called(name, args)
      const value = await answer(name, this, args)
      return flip ? run.flip(name, value) : value
    }
  return function (...args) {
    const flip = called(name, args)
    const value = answer(name, this, args)
    return flip ? run.flip(name, value) : value
  }
}

function fakeModule(id, target, real) {
  const keep = real[id]
  if (keep === true) return target
  return new Proxy(target, {
    get(t, key) {
      const value = t[key]
      if (keep && keep.includes(key)) return value
      if (id === 'fs' && key === 'promises') return fakeModule('fs.promises', value, real)
      return typeof value === 'function' ? recorded(`${id}.${String(key)}`, value) : value
    },
  })
}

function loadTarget(root, { file, names, real }) {
  const filename = path.join(root, file)
  const copy = new Module(filename)
  copy.filename = filename
  copy.paths = Module._nodeModulePaths(path.dirname(filename))
  copy.require = function (id) {
    return fakeModule(id, Module.prototype.require.call(this, id), real)
  }
  copy._compile(`${fs.readFileSync(filename, 'utf8')}\nmodule.exports.__private = { ${names.join(', ')} }\n`, filename)
  return copy.exports.__private
}

const defaultFlip = (name, value) => {
  if (typeof value === 'boolean') return !value
  if (typeof value === 'string') return `${value}-changed`
  if (value === null || value === undefined) return value
  return null
}

async function once(target, spec, scenario, fault) {
  const ctx = scenario.make()
  run = { log: [], at: 0, fault, scenario, ctx, flip: spec.flip || defaultFlip }
  const now = Date.now
  Date.now = () => 1700000000000 + run.at
  let outcome
  try {
    outcome = { value: show(await spec.run(target, ctx)) }
  } catch (error) {
    outcome = { thrown: show(error) }
  } finally {
    Date.now = now
  }
  if (run.missing) throw new Error(`harness: no answer for ${run.missing}`)
  return { log: run.log, outcome, state: show(ctx.state()), calls: run.at }
}

export async function collab(spec) {
  const old = loadTarget(spec.roots.old, spec),
    next = loadTarget(spec.roots.new, spec)
  let runs = 0,
    differences = 0,
    most = 0
  for (const scenario of spec.scenarios) {
    const clean = await once(old, spec, scenario, null)
    most = Math.max(most, clean.calls)
    const faults = [null]
    for (let at = 0; at < clean.calls; at++) {
      for (const make of spec.errors) faults.push({ at, kind: 'throw', make })
      faults.push({ at, kind: 'cancel' }, { at, kind: 'flip' })
    }
    for (const fault of faults) {
      const a = await once(old, spec, scenario, fault),
        b = await once(next, spec, scenario, fault)
      runs++
      if (!isDeepStrictEqual(a, b) && differences++ < 3) {
        const step = a.log.findIndex((call, i) => !isDeepStrictEqual(call, b.log[i]))
        console.log(spec.name, scenario.name, fault && { at: fault.at, kind: fault.kind }, 'first differing call', step)
        console.log(' old', JSON.stringify(a.log[step] ?? a.outcome).slice(0, 400))
        console.log(' new', JSON.stringify(b.log[step] ?? b.outcome).slice(0, 400))
      }
    }
  }
  console.log(`${spec.name}: ${spec.scenarios.length} scenarios, ${runs} runs, ${differences} differences, up to ${most} calls`)
  return differences
}
```

Every `real` map lists `fs: ['writeFileSync']`, because a marked copy run as "old" writes its hits through it at exit.

- [ ] **Step 7: Write `$E/scripts/mutate.mjs`**

```js
// node mutate.mjs <repo-relative file> <function line[,line...]> <workers> <test files...>
// Runs each mutant of the named functions, on separate copies, against the named tests, and prints
// the survivors. MUT_ALSO names slower tests a survivor must also pass. MUT_CMD replaces the tests
// with a command, run with CMP_NEW set to the copy, that fails when it sees a difference. MUT_SAMPLE
// runs that many mutants, picked by a seeded shuffle so a re-run picks the same ones.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const R = '/Volumes/Harry/works/albumStudio-photocraft'
const espree = createRequire(`${R}/package.json`)('espree')
const [file, line, workers, ...tests] = process.argv.slice(2)
const copies = process.env.MUT_ROOT
const source = fs.readFileSync(path.join(R, file), 'utf8')
const ast = espree.parse(source, { ecmaVersion: 'latest', sourceType: 'script', range: true, loc: true })

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return
  visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range') continue
    const value = node[key]
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit))
    else if (value && typeof value.type === 'string') walk(value, visit)
  }
}
const fns = new Map()
const lines = line.split(',').map(Number)
walk(ast, (n) => {
  if (/Function/.test(n.type) && lines.includes(n.loc.start.line) && !fns.has(n.loc.start.line)) fns.set(n.loc.start.line, n)
})
for (const at of lines) if (!fns.has(at)) throw new Error(`no function at line ${at}`)
const slice = (n) => source.slice(n.range[0], n.range[1])
const BOUNDARY = { '<': '<=', '<=': '<', '>': '>=', '>=': '>', '===': '!==', '!==': '===' }
const LOGICAL = { '&&': '||', '||': '&&', '??': '||' }
const sites = []
const add = (at, end, text, why, node) =>
  sites.push({ at, end, text, why: `${node.loc.start.line}:${node.loc.start.column} ${why}`, from: slice(node).slice(0, 60) })
const visit = (n) => {
  if (['IfStatement', 'ConditionalExpression', 'WhileStatement', 'DoWhileStatement', 'ForStatement'].includes(n.type) && n.test)
    add(n.test.range[0], n.test.range[1], `!(${slice(n.test)})`, 'negate', n.test)
  if (n.type === 'LogicalExpression' && LOGICAL[n.operator]) {
    const between = source.slice(n.left.range[1], n.right.range[0])
    const at = n.left.range[1] + between.indexOf(n.operator)
    add(at, at + n.operator.length, LOGICAL[n.operator], `${n.operator} swap`, n)
  }
  if (n.type === 'BinaryExpression' && BOUNDARY[n.operator]) {
    const between = source.slice(n.left.range[1], n.right.range[0])
    const at = n.left.range[1] + between.indexOf(n.operator)
    add(at, at + n.operator.length, BOUNDARY[n.operator], `${n.operator} boundary`, n)
  }
  if (n.type === 'UnaryExpression' && n.operator === '!') add(n.range[0], n.range[1], `(${slice(n.argument)})`, 'drop !', n)
  if (n.type === 'ContinueStatement' || n.type === 'BreakStatement') add(n.range[0], n.range[1], ';', `drop ${n.type}`, n)
}
for (const fn of fns.values()) walk(fn, visit)

let seed = 5300
const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
for (let i = sites.length - 1; i > 0; i--) {
  const j = Math.floor(random() * (i + 1))
  ;[sites[i], sites[j]] = [sites[j], sites[i]]
}
const total = Number(process.env.MUT_SAMPLE) || sites.length
const queue = sites.slice(0, total)
const also = (process.env.MUT_ALSO || '').split(' ').filter(Boolean)
const survivors = []
let timeouts = 0
function runTests(root, files) {
  return new Promise((resolve) => {
    const command = process.env.MUT_CMD
      ? ['zsh', '-c', process.env.MUT_CMD]
      : ['node', '--test', '--test-concurrency=1', ...files]
    const child = spawn(command[0], command.slice(1), {
      cwd: path.join(root, 'native/backend'),
      env: { ...process.env, CMP_NEW: root },
      stdio: 'ignore',
      detached: true,
    })
    const limit = setTimeout(() => {
      timeouts++
      process.kill(-child.pid, 'SIGKILL')
    }, Number(process.env.MUT_LIMIT) || 120000)
    child.on('exit', (code, signal) => {
      clearTimeout(limit)
      resolve(code === 0 && !signal)
    })
  })
}
async function worker(k) {
  const root = path.join(copies, String(k))
  const target = path.join(root, file)
  while (queue.length) {
    const site = queue.shift()
    fs.writeFileSync(target, source.slice(0, site.at) + site.text + source.slice(site.end))
    if ((await runTests(root, tests)) && (!also.length || (await runTests(root, also)))) survivors.push(site)
  }
  fs.writeFileSync(target, source)
}
await Promise.all(Array.from({ length: Number(workers) }, (_, k) => worker(k)))
console.log(`${total} mutants, ${total - survivors.length} caught, ${timeouts} by timeout, ${survivors.length} survived`)
for (const s of survivors.sort((a, b) => a.at - b.at)) console.log(`${s.why}: ${s.from}`)
```

- [ ] **Step 8: Write the shell helpers**

`$E/scripts/marks.sh`:

```bash
#!/bin/zsh
# marks.sh <test files, relative to native/backend or starting ../../ for the shared suite>
R=/Volumes/Harry/works/albumStudio-photocraft
S=/private/tmp/claude-501/-Volumes-Harry-works-albumStudio-photocraft/2821a411-2a3f-4a06-90c0-a3e281d60cf7/scratchpad/phase4b
E=$R/.superpowers/evidence/phase-4b3
M=$S/marked-4b3
BIN="$R/native/dist/Album Studio Latest.app/Contents/Resources/bin"
export ALBUM_STUDIO_PHOTOCRAFT_CLI="$BIN/photocraft-cli" ALBUM_STUDIO_RENAME_CLI="$BIN/album-studio-rename-exclusive"
cp $R/native/backend/test/*.js $M/native/backend/test/
cp -R $R/native/backend/test/fixtures $M/native/backend/test/ 2>/dev/null
cp $R/test/*.js $M/test/
cd $M/native/backend && node --test --test-concurrency=2 "$@" > $E/logs/marks-run.txt 2>&1
result=$?
cd $R && BASE_ROOT=$S/base-4b3 node $E/scripts/mark-report.mjs $M $S/marks-4b3 $E/logs/batch.tsv > $E/logs/marks-now.txt
/usr/bin/grep -E '^ *(# )?(tests|pass|fail) ' $E/logs/marks-run.txt | tail -3
/usr/bin/grep -E 'marks hit$|^ALL' $E/logs/marks-now.txt
exit $result
```

`$E/scripts/mutants.sh`:

```bash
#!/bin/zsh
# mutants.sh <name> <repo-relative file> <function line> <test files>
R=/Volumes/Harry/works/albumStudio-photocraft
S=/private/tmp/claude-501/-Volumes-Harry-works-albumStudio-photocraft/2821a411-2a3f-4a06-90c0-a3e281d60cf7/scratchpad/phase4b
E=$R/.superpowers/evidence/phase-4b3
name=$1; file=$2; line=$3; shift 3
BIN="$R/native/dist/Album Studio Latest.app/Contents/Resources/bin"
export ALBUM_STUDIO_PHOTOCRAFT_CLI="$BIN/photocraft-cli" ALBUM_STUDIO_RENAME_CLI="$BIN/album-studio-rename-exclusive"
export MUT_ROOT=$S/mut-4b3
for k in 0 1 2 3; do
  if [ ! -d $MUT_ROOT/$k ]; then
    mkdir -p $MUT_ROOT/$k
    git -C $R archive HEAD | tar -x -C $MUT_ROOT/$k
    ln -s $R/node_modules $MUT_ROOT/$k/node_modules
  fi
  cp $R/native/backend/test/*.js $MUT_ROOT/$k/native/backend/test/
  cp $R/native/backend/lib/*.js $MUT_ROOT/$k/native/backend/lib/
done
node $E/scripts/mutate.mjs $file $line 4 "$@" > $E/logs/mutants-$name.txt 2>&1
head -1 $E/logs/mutants-$name.txt
```

`$E/scripts/commit.sh`:

```bash
#!/bin/zsh
# commit.sh <message file> <files...>: commits only when the gate prints seven ok lines.
R=/Volumes/Harry/works/albumStudio-photocraft
E=$R/.superpowers/evidence/phase-4b3
msg=$1; shift
cd $R && npx prettier --write --ignore-unknown -- "$@" > /dev/null
$E/scripts/gate.sh $R > $E/logs/gate.txt 2>&1
n=$(/usr/bin/grep -c '^ok' $E/logs/gate.txt)
cat $E/logs/gate.txt
cd $R
if [ "$n" = "7" ]; then git add -- "$@" && git commit -q -F "$msg" && git log --oneline -1; else echo "NOT COMMITTED: $n of 7 ok"; fi
```

Run `chmod +x $E/scripts/*.sh`, and check that the copied `gate.sh` has no path relative to its old folder: `/usr/bin/grep -n 'dirname\|\$0\|phase0' $E/scripts/gate.sh`. Fix any it finds. Create an empty `$E/logs/survivors.md`.

`$E/scripts/timing.mjs`:

```js
// node timing.mjs <case>: the median of five runs of one case on the old and new code.
import { expose } from './compare.mjs'

const R = '/Volumes/Harry/works/albumStudio-photocraft'
const S = '/private/tmp/claude-501/-Volumes-Harry-works-albumStudio-photocraft/2821a411-2a3f-4a06-90c0-a3e281d60cf7/scratchpad/phase4b'
const cases = {} // Tasks 4, 5, 6 and 8 add theirs: name → (root) => async () => work
const make = cases[process.argv[2]]
async function median(work) {
  const times = []
  for (let i = 0; i < 5; i++) {
    const started = performance.now()
    await work()
    times.push(performance.now() - started)
  }
  return times.sort((a, b) => a - b)[2]
}
const oldMs = await median(await make(`${S}/base-4b3`, expose)),
  newMs = await median(await make(R, expose))
console.log(`${process.argv[2]}: old ${oldMs.toFixed(1)} ms, new ${newMs.toFixed(1)} ms, ${((newMs / oldMs - 1) * 100).toFixed(1)}%`)
```

- [ ] **Step 9: Smoke-test the tools**

Marks: `$E/scripts/marks.sh test/load_private.test.js`
Expected: the run passes and the last line reads `ALL: 1255/1814 hit, 559 unhit` or a little higher, since the loader's test reaches `runExport`.

Mutants: `$E/scripts/mutants.sh smoke native/backend/lib/parity.js 61 test/parity.test.js`
Expected: `agBox`'s mutants run, the first line's counts add up, and no copy of `parity.js` is left mutated (`cmp $R/native/backend/lib/parity.js $S/mut-4b3/0/native/backend/lib/parity.js`).

Collaborator sweep: write `$E/scripts/collab-toy.mjs`, with a tiny target in `$S/collab-toy/{old,new}/job.js` that requires `./store`, loops over items, catches per item and finishes in a `finally`. `new` is the same split into two helpers. Expected: 0 differences. Then, in a third copy, move the per-item lookup inside the `try`, and expect at least one difference. Record both in the ledger.

- [ ] **Step 10: Commit**

Write `$E/logs/msg.txt`:

```text
test: add a loader for private backend functions

Tests can now reach a module's private functions and replace the collaborators it destructures at
load, without adding a test-only export to production code.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

Run in the background: `$E/scripts/commit.sh $E/logs/msg.txt native/backend/test/load_private.js native/backend/test/load_private.test.js`
Expected: seven `ok` lines and the new commit.

---

### Task 2: Pin the stack slots of h and v photos

**Files:**
- Modify: `test/proof_renderer_pinning.test.js`

**Interfaces:**
- Consumes: `renderPageProof` from `src/proof_renderer.js`, and the test file's `common` and `f` fixtures.
- Produces: pins that Task 9 relies on when it splits `draw`.

- [ ] **Step 1: Add three pins**

Solid colours make the pixel check independent of the JPEG encoder. In a new `test()` block, write a red landscape JPEG and a blue portrait JPEG into the fixture's temporary folder, and give the page two overlapping frames, `toolkithframe1` (100,60,180×120) and `toolkitvframe1` (150,40,100×200). The overlap covers (200,100).

| Test | `psdLayers` stack, bottom to top | Expected at (200,100) |
|---|---|---|
| `the v frame above the h frame keeps its photo on top` | Paper, `toolkithframe1`, `toolkitvframe1` | blue |
| `the h frame above the v frame keeps its photo on top` | Paper, `toolkitvframe1`, `toolkithframe1` | red |
| `two frames with one name share a slot, and one photo is lost` | Paper, `toolkithframe1`, `toolkithframe1` (two h photos, red and green, frames side by side) | green in the second frame, paper in the first |

Each row asserts the pixel within ±12 per channel of the expected colour, and the SHA-256 of the output as in the rest of the file, taken from a first run on today's code. The third row follows from `frameOrder`, a Map by name: both photos land in the later slot and green, built second, replaces red, while the first slot stays empty. It's named as today's behaviour, not as a promise; the log's open item says a photo is lost there.

- [ ] **Step 2: Check the pins**

Run: `cd $R && node --test test/proof_renderer_pinning.test.js`
Expected: PASS.

Then check them on a scratch copy, so the repo isn't touched:

```bash
mkdir -p $S/t2-copy && git -C $R archive HEAD | tar -x -C $S/t2-copy && ln -s $R/node_modules $S/t2-copy/node_modules
cp $R/test/proof_renderer_pinning.test.js $S/t2-copy/test/
```

In `$S/t2-copy/src/proof_renderer.js`, change `const at = frameOrder.get(frames[i].name)`:
- to `const at = undefined`, which puts every photo on top;
- then to `const at = [...frameOrder.values()][i]`, which takes slots in stack order and ignores names.

Run `node --test test/proof_renderer_pinning.test.js` in the copy after each.
Expected: both fail the new rows.

- [ ] **Step 3: Commit**

Message: `test: pin the stack slots of h and v photos` with this body: "On an edited-template page, each photo takes its frame's place in the layer stack. The two frames sharing one name lose a photo today; that row records it, as the log's open item says." Add the trailer, then run `$E/scripts/commit.sh $E/logs/msg.txt test/proof_renderer_pinning.test.js`.
Expected: seven `ok` lines and the new commit.

---

### Task 3: `validateProfile` and `jpegInfo`

**Files:**
- Create: `native/backend/test/color_icc_validation.test.js`, `native/backend/test/pdf_jpeg_markers.test.js`
- Modify: `native/backend/lib/color.js:317-366`, `native/backend/lib/pdf.js:52-153`

**Interfaces:**
- Consumes: `loadPrivate`, `adobeCompatibleProfile`, `grayGammaProfile`, `rgbLutProfile` and `icc` from `color_edge_fixtures.js`.
- Produces: unchanged `validateProfile(profile)` and `jpegInfo(buf) → { width, height, components, profile }`.

- [ ] **Step 1: Pin `validateProfile`**

Each row changes one thing in a copy of a valid profile and asserts the exact message. `H` is 'The sheet has an invalid colour profile…', `C` is 'The sheet colour profile is invalid or unsupported (<detail>)…', `T` is 'The sheet colour profile has an invalid tag table.', and `G` is 'The sheet colour profile contains an invalid or truncated tag.'. A small `tagged(tags)` builder writes a profile with chosen tags, for the boundary rows.

| Row | Change | Expected |
|---|---|---|
| not a Buffer | `new Uint8Array(good)` | `H` |
| 131 bytes, and 132 with no tags | truncate | `H`, then `T` |
| over the limit | `Buffer.alloc(16 * 1024 * 1024 + 1)` with a matching length | `H` |
| declared length differs | field 0 + 1 | `H` |
| no signature | bytes 36–40 | `H` |
| version 3 | byte 8 | `C`, 'unsupported ICC version' |
| class `link` | bytes 12–16 | `C`, 'not a source image profile' |
| space `XYZ `; PCS `RGB `; intent 4 | one each | `C`, 'invalid colour space, PCS or intent' |
| intent 3 | field 64 | accepted |
| count 0; 4097; table past the end | field 128 | `T` |
| count 4096, each tag valid | `tagged` | accepted |
| repeated signature; offset 134; offset inside the table; size 7; size longer than the file; offset past the end | one each | `G` |
| offset exactly after the table; size 8; tag ending exactly at the end | `tagged` | accepted |
| `rXYZ` size 19; `wtpt` of type `text` | one each | `C`, 'invalid matrix or white point tag' |
| `first failure wins`: bad version and bad class; bad count and bad tag | two at once | the earlier message |

The returned value is the same Buffer (`assert.equal(validateProfile(good), good)`).

- [ ] **Step 2: Pin `jpegInfo`**

`pdf_jpeg_markers.test.js` gets `jpegInfo` through `loadPrivate('../lib/pdf.js', { names: ['jpegInfo'] })` and builds files from bytes:

```js
const seg = (marker, payload = []) =>
  Buffer.from([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload])
const sof = (marker = 0xc0, { precision = 8, height = 2, width = 3, ids = [1, 2, 3] } = {}) =>
  seg(marker, [precision, 0, height, 0, width, ids.length, ...ids.flatMap((id) => [id, 0x11, 0])])
const sos = (ids = [1, 2, 3]) => seg(0xda, [ids.length, ...ids.flatMap((id) => [id, 0]), 0, 63, 0])
const jpeg = (...parts) => Buffer.concat([Buffer.from([0xff, 0xd8]), ...parts, Buffer.from([0xff, 0xd9])])
const data = Buffer.from([0x12, 0x34])
const ok = () => jpeg(sof(), sos(), data)
const icc = (sequence, total, bytes) =>
  seg(0xe2, [...Buffer.from('ICC_PROFILE\0'), sequence, total, ...bytes])
```

| Row | Bytes | Expected |
|---|---|---|
| 3 bytes; no SOI | `FF D8 FF`; `FF D9 00 00` | 'Invalid JPEG signature.' |
| junk where a marker belongs | `FF D8 00 …` | 'Invalid JPEG marker.' |
| fill bytes, then EOI | `FF D8 FF FF FF D9` | 'Truncated JPEG data, missing frame or missing SOS scan.' |
| fill bytes to the end | `FF D8 FF FF` | 'Invalid JPEG marker.' |
| second SOI; `FF 00` | one each | 'Invalid JPEG marker.' |
| TEM and RST0–RST7 after the frame | `FF 01`, `FF D0`, `FF D7` | accepted |
| length field missing | ends after `FF E0` | 'Truncated JPEG marker length.' |
| length 1; past the end | one each | 'Truncated JPEG segment.' |
| length 2 at the very end | ends after `FF E0 00 02` | 'Truncated JPEG data…' |
| a marker below `C0` with a segment | `seg(0x02)` before the frame | accepted |
| SOF markers `C0 C1 C2 C9 CA` | `sof(m)` | accepted |
| `C3 C5 C6 C7 CB CD CE CF` | `sof(m)` | 'Unsupported or malformed JPEG DCT frame.' |
| `C4 C8 CC` | a segment, not a frame | accepted |
| second frame; 5-byte payload; precision 12; 2 components; wrong length | one each | 'Unsupported or malformed…' |
| components 1, 3, 4 | `ids` | accepted, `components` matches |
| repeated component id | `ids: [1, 1, 2]` | 'Duplicate JPEG frame components.' |
| SOS before SOF; count 0; count 4 of 3; wrong length | one each | 'Malformed JPEG SOS scan header.' |
| unknown component; repeated component in a scan | one each | 'Invalid JPEG scan component.' |
| APP2 that isn't ICC | `seg(0xe2, [1, 2, 3])` | accepted, `profile: null` |
| ICC payload of 13 bytes | one row | 'Truncated JPEG ICC header.' |
| ICC sequence 0; total 0; sequence over total; totals disagree | one each | 'Invalid JPEG ICC chunk sequence.' |
| same chunk twice | one row | 'Duplicate JPEG ICC chunk.' |
| chunk 2 of 2 missing | one row | 'Missing JPEG ICC chunk.' |
| chunks 2 then 1 | one row | accepted, the profile's bytes are in order |
| RGB frame with a `GRAY` profile; 4 components with `RGB ` | one each | 'JPEG ICC profile channel mismatch.' |
| invalid profile bytes | one row | `validateProfile`'s message |
| scan with no data; only a restart marker | `FF D9` right after SOS; `FF D0` | 'The JPEG scan has no entropy data.' |
| `FF 00` only; data with RST inside; two scans | one each | accepted |
| no EOI; no scan; no frame | one each | 'Truncated JPEG data…' |
| TEM before SOF; width 0; height 0 | one each | 'Invalid JPEG dimensions.' |
| `first failure wins`: duplicate components in a second frame; bad scan then a bad ICC chunk | one each | the earlier message |

Valid rows assert the whole result, including key order: `{ width: 3, height: 2, components: 3, profile: null }`.

- [ ] **Step 3: Marks and mutants**

```bash
$E/scripts/marks.sh test/color_icc_validation.test.js test/pdf_jpeg_markers.test.js
$E/scripts/mutants.sh validateProfile native/backend/lib/color.js 317 test/color_icc_validation.test.js
$E/scripts/mutants.sh jpegInfo native/backend/lib/pdf.js 52 test/pdf_jpeg_markers.test.js
```

Expected: `validateProfile` shows 57/57 and `jpegInfo` 141/142, its one miss being `!frameIds`. Each survivor gets a row, or a line with its reason in `$E/logs/survivors.md`.

- [ ] **Step 4: Commit the pins**

Message: `test: pin colour profile and JPEG marker validation`. Run `$E/scripts/commit.sh $E/logs/msg.txt native/backend/test/color_icc_validation.test.js native/backend/test/pdf_jpeg_markers.test.js`.
Expected: seven `ok` lines and the new commit.

- [ ] **Step 5: Split `validateProfile`**

In `color.js`, keeping the order of every check:
- `invalidProfileHeader(profile)`: the first `if`'s condition, as a predicate.
- `checkProfileHeader(profile)`: version, class, then space, PCS and intent, keeping `profileError`.
- `checkProfileTag(profile, i, count, seen)`: reads the entry, checks it with an `invalidTagEntry(profile, signature, offset, size, count, seen)` predicate, adds the signature to `seen` before `validateCurve`, then the XYZ check.
- `validateProfile` keeps the count check, the loop and `return profile`.

- [ ] **Step 6: Split `jpegInfo`**

In `pdf.js`, parser state becomes one object: `{ at, frame, frameIds, scans, ended, chunks, chunkCount }`.
- `nextJpegMarker(buf, state)`: the `0xff` check, fill bytes and marker byte.
- `jpegSegmentLength(buf, at)`: the two truncation checks.
- `isDctFrameMarker(marker)`: the frame predicate.
- `checkDctFrame(marker, payload, state)`, `checkScanHeader(payload, state)`, `collectIccChunk(payload, state)`.
- `skipEntropy(buf, at)`: returns the new offset and throws if the scan has no data.
- `readJpegSegment(buf, state)`: one pass of today's loop body, in today's order. `0xd9` sets `state.ended`, and restart markers return early.
- `jpegProfile(state)`: the chunk check, `validateProfile` and the channel check.

`jpegInfo` becomes `while (state.at < buf.length && !state.ended) readJpegSegment(buf, state)`, followed by today's final checks. The completeness check and the size check stay before `jpegProfile`.

- [ ] **Step 7: Compare old and new**

Write `$E/scripts/cmp-parsers.mjs`. It loads `jpegInfo` and `validateProfile` from `$S/base-4b3` and the repo, by compiling each with an appended export, and wraps each so every call gets a fresh `Buffer.from(view)`, because `compare` passes arguments through `structuredClone`.

Generators, seed 5301:
- `validateProfile`: 30,000 inputs from the four fixture profiles. Each breaks one field chosen from the header and tag table (a random offset, length, count or signature, or a random byte), or none (15%).
- `jpegInfo`: 30,000 inputs from a baseline sharp JPEG, a progressive one, one with an ICC profile and the test's byte-built ones. Each makes one change: replace a marker, change a length, flip a payload byte, insert a fill, TEM or RST marker, delete or repeat a segment, swap two segments, or truncate at a random offset. A further 10,000 make two changes, for which error wins.
- Predicates: `invalidProfileHeader`, `invalidTagEntry` and `isDctFrameMarker` each get 20,000 random inputs against the old inline condition, copied verbatim into the script from base.

Run: `node $E/scripts/cmp-parsers.mjs | tee $E/logs/cmp-parsers.txt`
Expected: 0 differences on every line.

Prove it, with the lines of the new helpers from `fn-complexity.mjs`:

```bash
MUT_SAMPLE=10 MUT_LIMIT=600000 MUT_CMD="CMP_ONLY=jpegInfo node $E/scripts/cmp-parsers.mjs" $E/scripts/mutants.sh sample-jpeg native/backend/lib/pdf.js <helper lines>
MUT_SAMPLE=10 MUT_LIMIT=600000 MUT_CMD="CMP_ONLY=validateProfile node $E/scripts/cmp-parsers.mjs" $E/scripts/mutants.sh sample-icc native/backend/lib/color.js <helper lines>
```

Expected: `10 mutants, 10 caught`. A miss is examined: an equivalent mutant goes in `$E/logs/survivors.md`; anything else means the generator needs a new rule.

Tasks 4 to 11 prove their comparisons the same way, sampling the new helpers of the functions they split: `MUT_SAMPLE`, `MUT_LIMIT` and `MUT_CMD` naming the task's script.

- [ ] **Step 8: Complexity, baseline, commit**

```bash
cd $R
node $E/scripts/fn-complexity.mjs native/backend/lib/pdf.js | sort -n | tail -5
node $E/scripts/fn-complexity.mjs native/backend/lib/color.js | sort -n | tail -8
node native/scripts/check-readability.mjs --update
```

Expected: `validateProfile`, `jpegInfo` and every new helper at 20 or less. Message: `refactor: split colour profile and JPEG marker validation`, with a body that gives the comparison counts. Run `$E/scripts/commit.sh $E/logs/msg.txt native/backend/lib/pdf.js native/backend/lib/color.js native/scripts/readability-baseline.json`.
Expected: seven `ok` lines and the new commit.

---

### Task 4: PSD composite parsers

**Files:**
- Create: `native/backend/test/color_psd_structure.test.js`
- Modify: `native/backend/lib/color.js` (`compositeMetadata`, `compositePlanes`, `decodeCmykComposite`)

**Interfaces:**
- Consumes: `loadPrivate`.
- Produces: unchanged `compositeMetadata(buf)`, `compositePlanes(buf, shape, compressionAt, error)` and `decodeCmykComposite(buf)`. New private helper `boundsCheck(buf, error) → need(at, size, end = buf.length)`.

- [ ] **Step 1: Write the file builder**

`color_psd_structure.test.js` builds documents by section, so each row controls one field:

```js
const u16 = (value) => {
  const bytes = Buffer.alloc(2)
  bytes.writeUInt16BE(value)
  return bytes
}
const u32 = (value) => {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32BE(value)
  return bytes
}
const len = (value, wide) => {
  const bytes = Buffer.alloc(wide)
  bytes.writeUIntBE(value, wide - 4, 4)
  return bytes
}
function psd({ version = 1, channels = 3, height = 2, width = 2, depth = 8, mode = 3, colour = [], resources = [], layers = null, data = null } = {}) {
  const head = Buffer.alloc(26)
  head.write('8BPS', 0, 'ascii')
  head.writeUInt16BE(version, 4)
  head.writeUInt16BE(channels, 12)
  head.writeUInt32BE(height, 14)
  head.writeUInt32BE(width, 18)
  head.writeUInt16BE(depth, 22)
  head.writeUInt16BE(mode, 24)
  const resourceBytes = Buffer.concat(resources)
  const layerBytes = layers || Buffer.alloc(0)
  const plain = data || Buffer.concat([Buffer.alloc(2), Buffer.alloc(width * height * channels * (depth / 8), 200)])
  const wide = version === 2 ? 8 : 4
  return Buffer.concat([head, u32(colour.length), Buffer.from(colour), u32(resourceBytes.length), resourceBytes, len(layerBytes.length, wide), layerBytes, plain])
}
const resource = (id, body, { name = [0, 0], signature = '8BIM' } = {}) =>
  Buffer.concat([Buffer.from(signature), u16(id), Buffer.from(name), u32(body.length), body, Buffer.alloc(body.length % 2)])
const merged = (flag) => resource(1057, Buffer.from([0, 0, 0, 1, flag]))
// `count` null leaves the info section empty; a negative count declares merged transparency.
function layerSection(count, blocks = [], wide = 4) {
  const info = count === null ? Buffer.alloc(0) : Buffer.from([(count >> 8) & 255, count & 255])
  return Buffer.concat([len(info.length, wide), info, u32(0), ...blocks])
}
const block = (key, body, { signature = '8BIM', wide = 4 } = {}) =>
  Buffer.concat([Buffer.from(signature), Buffer.from(key), len(body.length, wide), body])
```

Size rows pass `data: Buffer.alloc(2)`, so nothing large is allocated.

- [ ] **Step 2: Pin `compositeMetadata`**

`E(x)` is `compositeError(x)`'s full text. Each row changes one thing. Reach it through `loadPrivate('../lib/color.js', { names: ['compositeMetadata', 'compositePlanes'] })`.

| Row | Change | Expected |
|---|---|---|
| 29 bytes | truncate | `E('truncated document data')` |
| signature | `8BPX` | `E('not a PSD/PSB document')` |
| version 3; depth 2; channels 0; channels 57; width 0; height 0 | one each | `E('invalid header')` |
| depths 1, 8, 16, 32 | one each | accepted |
| PSD width 30001; height 30001; PSB 300001 | one each | `E('dimensions exceed the PSD/PSB format limit')` |
| PSD 30000 × 1; PSB 300000 × 1 | one each | past that check |
| over 512 MiB decoded | 20000 × 20000 | `E('compatibility composite exceeds the 512 MiB decoding limit')` |
| exactly 512 MiB | a 4-channel size that lands on the limit | past that check |
| colour section past the end | length too long | truncated |
| resource section past the end | length too long | truncated |
| resource signature `8BIX`; 6 bytes left | one each | `E('invalid image resource')`; truncated |
| name past the section; size past the section | one each | truncated |
| even and odd names | `name` | accepted, the same result |
| 1057 with size 4; version 2; twice | one each | `E('invalid merged-composite declaration')` |
| 1057 flag 0; flag 1; none | one each | `realMerged` false; true; null |
| odd resource with no pad at the end | one row | `E('truncated image resource padding')` |
| PSD layer length too long; PSB too long | one each | `E('invalid layer section length')` |
| info length 1 | one row | `E('truncated layer count')` |
| count -1; count 1; no info | one each | `alpha` true; false; null |
| primary and `Lr16` disagree | one row | `E('conflicting merged transparency declarations')` |
| primary and `Lr16` agree | one row | accepted |
| mode 1 with a layer section | one row | layers not scanned |
| mode 4 with a layer section | one row | scanned |
| padding 0, 1, 2, 3 before a block | one each | block read |
| zeros to the end | one row | stops |
| 2 zeros, then exactly the end | one row | stops |
| signature `8BXX` | one row | `E('invalid global layer block')` |
| `8B64` block; PSB long key; PSB short key | one each | 8-byte, 8-byte, 4-byte size |
| `Layr` at depth 16; `Lr16` at 8, 16; `Lr32` at 32, 16 | one each | declares; ignored or declares by depth |
| RGB with 2 channels; 5 channels | one each | `E('unsupported RGB extra channels')` |
| count -1 with 3 channels | one row | `E('merged transparency channel is missing')` |
| 4 channels, no declaration | one row | `E('fourth-channel transparency provenance is unknown')` |
| raw composite one byte short | one row | truncated |
| depth 1, raw, short | one row | accepted, the bounds check is skipped |
| compression 1, short data | one row | accepted here |
| `first failure wins`: bad version and bad resource; two conflicting blocks then a bad signature | one each | the earlier message |

Valid rows assert the full result, including `compositeAt`.

- [ ] **Step 3: Pin `compositePlanes`**

Direct calls with a shape object:

| Row | Input | Expected |
|---|---|---|
| depth 32 | `{ width: 1, height: 1, channels: 3, depth: 32 }` | `error('unsupported or oversized compatibility composite')` |
| unsafe size; over the limit | width 2 ** 53; 1 GiB | the same |
| `compressionAt` -1; 1.5 | one each | `error('truncated document data')` |
| negative width with raw data; a fractional table size | one each | the same |
| compression 0 | short; exact | truncated; the same bytes, as a subarray of `buf` |
| compression 1 | PSD 2-byte table; PSB 4-byte table; table past the end; rows past the end | decoded; decoded; truncated; truncated |
| control 128 | one row | skipped |
| literal past the row's end | one row | `error('truncated RLE literal')` |
| repeat with no value | one row | `error('truncated RLE repeat')` |
| row too long; row too short | one each | `error('an RLE row exceeds its width')`; `error('truncated RLE row')` |
| compression 2 | valid; bad deflate; too long; too short | planes; `error('invalid or oversized ZIP composite')`, twice; `error('ZIP composite length does not match its planes')` |
| compression 3 | 8-bit; 16-bit with wrap past 65535 | delta undone |
| compression 4 | one row | `error('unsupported composite compression')` |

- [ ] **Step 4: Pin `decodeCmykComposite`**

`C(x)` is `cmykError(x)`'s text. Direct calls on built documents:

| Row | Change | Expected |
|---|---|---|
| short; `8BPX`; mode 3 | one each | `C('truncated document data')`; `C('not a CMYK PSD/PSB')`, twice |
| version 3; depth 32; width 0; height 0; 6 channels | one each | `C('unsupported depth or extra spot channels')` |
| PSD 30001 wide; 30001 high; PSB 300001 | one each | `C('dimensions exceed the PSD/PSB format limit')` |
| over 512 MiB | 20000 × 20000 × 4 | `C('compatibility composite exceeds the 512 MiB decoding limit')` |
| resource section past the end | one row | truncated |
| signature; name past the end; size past the end | one each | `C('invalid resource signature')`; `C('truncated resource name')`; `C('truncated resource')` |
| 1057 with size 4; version 2; twice | one each | `C('invalid merged-composite declaration')` |
| odd resource with no pad | one row | `C('truncated resource padding')` |
| `realMerged` false | one row | `C('the document declares no real merged composite')` |
| layer length too long, PSD and PSB | one each | `C('invalid layer section length')` |
| layer section past the end | one row | truncated |
| 4 channels, count -1 | one row | `C('transparency plane is missing')` |
| 5 channels, count 1 | one row | `C('an extra channel is not identified as transparency')` |
| `decoded samples keep their bytes`: 8-bit, 16-bit; alpha 0, 128, 255; no alpha | one each | the exact little-endian bytes, by hash |
| RGB through `decodeRgbComposite`, 8-bit and 16-bit, alpha 0 and partial | one each | the exact bytes |

- [ ] **Step 5: Marks and mutants**

```bash
$E/scripts/marks.sh test/color_psd_structure.test.js
$E/scripts/mutants.sh compositeMetadata native/backend/lib/color.js 85 test/color_psd_structure.test.js
$E/scripts/mutants.sh compositePlanes native/backend/lib/color.js 189 test/color_psd_structure.test.js
$E/scripts/mutants.sh decodeCmykComposite native/backend/lib/color.js 563 test/color_psd_structure.test.js
```

The line numbers here are `2449d75`'s; if Task 3 moved them, read the current line from `node $E/scripts/fn-complexity.mjs native/backend/lib/color.js`.

Expected: `compositeMetadata` 130/135, `compositePlanes` 62/62, `decodeCmykComposite` 97/102, each miss listed in Ruling 4. Each survivor gets a row or a reason.

- [ ] **Step 6: Commit the pins**

Message: `test: pin the PSD composite parsers`. Run `$E/scripts/commit.sh $E/logs/msg.txt native/backend/test/color_psd_structure.test.js`.
Expected: seven `ok` lines and the new commit.

- [ ] **Step 7: Split the three parsers**

In `color.js`:
- `boundsCheck(buf, error)` returns `need(at, size, end = buf.length)`, replacing all three closures. `compositePlanes` and `decodeCmykComposite` never pass `end`, so behaviour doesn't change.
- `psdHeader(buf)`: reads and validates the header, including both limits, and returns `{ version, channels, height, width, depth, mode }`.
- `scanResources(buf, at, need)`: returns `{ resourceEnd, realMerged }`.
- `layerLengthReader(buf, need)`: returns `lengthAt(where, bytes, end)`.
- `mergeDeclaration(buf, where, size, alpha)`: pure, replacing `declare`; returns the new `alpha`.
- `scanGlobalBlocks(buf, at, layerEnd, head, alpha, lengthAt, need)`: returns `alpha`. The padding loop and the `break` stay in it.
- `scanLayerSection(buf, layerAt, layerEnd, head, lengthAt, need)`: returns `alpha`.
- `checkRgbChannels(buf, head, alpha, layerEnd, need)`.
- `rleRowLength(buf, tableAt, row, countBytes)`, `decodeRleRow(buf, at, end, planar, destination, rowBytes, error)`, `decodeRlePlanes(...)`, `inflatePlanes(buf, at, expected, error)` and `undoDelta(planar, shape)`. `undoDelta` keeps one nested loop.
- `cmykHeader(buf, need)`, `scanCmykResources(buf, start, end, need)` (not merged with `scanResources`; see Ruling 9) and `unmatteCmyk(planar, shape, alpha)`, a single loop.

Keep `decodeCmykComposite`'s order: `need(layerAt, layerLength)`, then `compositeMetadata(buf).alpha`, then the channel checks, then `compositePlanes`.

- [ ] **Step 8: Compare old and new**

Extend `$E/scripts/cmp-parsers.mjs`, seed 5401:
- `compositeMetadata`: 40,000 inputs from the builder's valid documents and `taggedPsd8` and `rawPsd` fixtures, each with one change (a header field, a resource field, a layer-section field, a global block's key, signature or size, a padding length, a truncation), or none. A further 10,000 make two changes.
- `compositePlanes`: 20,000 from valid raw, RLE, ZIP and ZIP-with-prediction planes, each with one change to a table entry, control byte, deflate byte or the compression value.
- `decodeCmykComposite`: 20,000, by the same scheme.
- `mergeDeclaration`: 20,000 random `(size, count, alpha)` against the old closure, copied verbatim.
- Results compare by value, with `data` and `planar` compared as bytes.

Run: `node $E/scripts/cmp-parsers.mjs | tee $E/logs/cmp-parsers.txt`
Expected: 0 differences on every line. Prove it with 10 sampled mutants of the new code, each caught.

`timing.mjs`: 8-bit CMYK at 3600×2400, median of 5, old against new.
Expected: new within 10% of old.

- [ ] **Step 9: Complexity, baseline, commit**

Expected: all three functions and every new helper at 20 or less. Re-record the baseline. Message: `refactor: split the PSD composite parsers`, with the comparison counts. Run `$E/scripts/commit.sh $E/logs/msg.txt native/backend/lib/color.js native/scripts/readability-baseline.json`.
Expected: seven `ok` lines and the new commit.

---

### Task 5: `psdPixels`

**Files:**
- Create: `native/backend/test/color_psd_pixels.test.js`
- Modify: `native/backend/lib/color.js` (`psdPixels`)

**Interfaces:**
- Consumes: `loadPrivate`, and Task 4's file builder, moved to `native/backend/test/psd_builder.js` so both test files share it.
- Produces: unchanged `psdPixels(psdPath, { buffer, inMemory })`.

- [ ] **Step 1: Pin `psdPixels`**

Load with `loadPrivate('../lib/color.js', { stubs: { './photocraft': { PhotoCraftSession: FakeSession } } })`, where `FakeSession` records `call`, `run` and `close`, writes a small real PNG at `doc.save`, has a `readPath` static and a `writePath` method, and can be told to fail at any step or to write a PNG without a profile.

| Row | Input | Expected |
|---|---|---|
| over the source limit | `buffer: { length: MAX_PSD_SOURCE_BYTES + 1 }` | the policy message |
| CMYK, no profile | a CMYK document | `C('the actual source profile is absent')` |
| CMYK with a profile | one row | goes to `profiledCmyk` |
| RGB with a CMYK profile | one row | `E('the RGB source profile does not match its channels')` |
| grey with a grey profile; grey with no profile | one each | the engine path, profile check on `meta.icc` |
| Lab | one row | the engine path |
| RGB 32-bit | one row | the engine path |
| `realMerged` false | one row | the engine path |
| all black, `realMerged` null | one row | the engine path |
| all black, `realMerged` true | one row | the stored composite |
| only the last pixel not black, 8-bit; 16-bit with only a low byte set | one each | the stored composite |
| 8-bit untagged | one row | `{ input, raw, width, height }` raw result |
| 8-bit tagged | one row | `profiledRgba` |
| 16-bit tagged; 16-bit untagged | one each | `profiledRgba`; `profiledRgba` with the untagged profile |
| engine fails at `doc.open`, `run`, `doc.save` | one each | the failure, stage retired |
| engine fails and close fails | one row | message ends ' PhotoCraft close also failed: …', `closeError` set |
| only close fails | one row | the close error, stage retired |
| `reserveBytes` fails | one row | the failure, close not called, stage retired |
| PNG with no profile when the source has one | one row | 'The editor render did not retain a verifiable colour profile…' |
| PNG with no profile, no source profile | one row | `{ input, width, height, cleanup }`, no check |
| PNG with a bad profile | one row | the profile error, stage retired |
| `stage.assertFiles` fails | one row, by editing the stage | the failure, stage retired |
| engine bytes | any engine row | the frozen file's bytes equal `buf`, with a `.psb` name when version is 2 |
| `first failure wins`: CMYK with no profile and a bad composite | one row | the earlier message |

- [ ] **Step 2: Marks and mutants**

```bash
$E/scripts/marks.sh test/color_psd_pixels.test.js test/color_fallback_snapshot.test.js
$E/scripts/mutants.sh psdPixels native/backend/lib/color.js 706 test/color_psd_pixels.test.js test/color_fallback_snapshot.test.js
```

Use the current line, as in Task 4.
Expected: 77/79, its misses in Ruling 4. Each survivor gets a row or a reason.

- [ ] **Step 3: Commit the pins**

Message: `test: pin psdPixels' routes and failures`. Run `$E/scripts/commit.sh $E/logs/msg.txt native/backend/test/color_psd_pixels.test.js native/backend/test/color_psd_structure.test.js native/backend/test/psd_builder.js`.
Expected: seven `ok` lines and the new commit.

- [ ] **Step 4: Split `psdPixels`**

- `hasNonBlackPixel(data, depth)`: pure, one nested loop that exits on the first hit.
- `storedComposite(buf, source, profile, inMemory)`: `await`s the RGB branch and returns a result, or null to fall through. `source.mode === 3 && source.realMerged !== false && [8, 16].includes(source.depth)` stays its first test.
- `renderInEngine(frozen, out, buf, stage, source)`: the first `try` and the close merge; returns the failure or undefined. `pc` stays local to it.
- `verifiedEngineOutput(stage, out, profile)`: the second `try`'s body.
- `psdPixels` keeps the head through the RGB check, then calls these. Keep `createPrivateStage` before the file name is built, and both `finishPrivateStage` calls.

- [ ] **Step 5: Compare old and new**

Write `$E/scripts/sweep-pixels.mjs`, using `sweep()` with `install` for each version's fake engine. Scenarios: engine path; engine path with a profile; stored composite. Modes `once` and `stop`, with `recover` as a no-op.

`cmp-parsers.mjs` adds `hasNonBlackPixel`: 20,000 random 8-bit and 16-bit buffers, mostly black, against the old loop, copied verbatim.

`$E/scripts/cmp-pixels.mjs` runs every Step 1 input through `compareAsync`, on old and new with the fake engine (`expose`'s `stubs`), comparing the result, the error fields and the engine's call log.

Run: `node $E/scripts/cmp-pixels.mjs | tee $E/logs/cmp-pixels.txt`, then `node $E/scripts/sweep-pixels.mjs | tee $E/logs/sweep-pixels.txt`
Expected: 0 differences. Prove it with 5 sampled mutants of the new code, each caught by `cmp-pixels.mjs`.

`timing.mjs`: a black 3600×2400 RGB composite (the full scan), old against new.
Expected: new within 10% of old.

- [ ] **Step 6: Complexity, baseline, commit**

Expected: `psdPixels` and every helper at 20 or less. Message: `refactor: split psdPixels`, with the comparison counts. Run `$E/scripts/commit.sh $E/logs/msg.txt native/backend/lib/color.js native/scripts/readability-baseline.json`.
Expected: seven `ok` lines and the new commit.

---

### Task 6: Template frames and art

**Files:**
- Create: `native/backend/test/psd_template_frames.test.js`
- Modify: `native/backend/lib/psd_template.js` (`collectFrames`, `shapeAlpha`, `templateArt`)

**Interfaces:**
- Consumes: `loadPrivate`.
- Produces: unchanged `collectFrames(nodes, out, hiddenParent)` and `templateArt(psdPath, maxEdge, { sourceDigest })`. `f.node` stays non-enumerable. `collectFrames` is also used by `preflight.js`.

- [ ] **Step 1: Pin `collectFrames` and `shapeAlpha`**

`collectFrames`, on plain nodes:

| Row | Node | Expected |
|---|---|---|
| no bounds | `{ name: 'toolkithframe1' }` | no frame |
| `right` or `bottom` missing | one each | no frame |
| zero width with a mask | mask gives the area, each mask side given or missing | the mask's box, or no frame when the mask is empty |
| zero height with a mask | one row | the mask's box |
| non-frame layer with children | one row | children collected, hidden parent passed on |
| opacity given; missing | one each | that value; 1 |
| `z` | three frames | 0, 1, 2 |
| `node` | any | same object, not in `Object.keys(f)` |

`shapeAlpha`, through `loadPrivate('../lib/psd_template.js', { names: ['shapeAlpha'] })`, with `f = { x, y, w, h, node }` and pixels by hand:

| Row | Node | Expected |
|---|---|---|
| neither image nor mask | one row | null |
| image with width 0; height 0 | one each | null |
| fully opaque image | one row | null |
| left and top missing | one row | read as 0 |
| partial alpha | one row | those alpha bytes |
| frame hanging off each edge of the image | four rows | 0 outside |
| disabled mask; mask with no pixels; mask width 0 | one each | mask ignored |
| mask, `positionRelativeToLayer` true and false; `left` and `top` given and missing; node `left` and `top` missing | one each | exact bytes |
| `defaultColor` number, missing | one each | that value outside the mask; 0 |
| off each edge of the mask | four rows | the default |
| mask value 255 | one row | unchanged, `shaped` stays false |
| image and mask both shaped | one row | `(out * v + 127) / 255`, truncated by the array, exact bytes |

- [ ] **Step 2: Pin `templateArt`'s job**

A small real PSD fixture with one frame, written by `ag.writePsdBuffer`, and `ALBUM_STUDIO_CACHE_DIR` pointed at a temporary folder. Change `art-2400.json` between calls:

| Row | Change | Expected |
|---|---|---|
| cached and valid | none | no decode, the same object |
| valid with `sourceDigest` | pass it | no second hash |
| backdrop outside the folder; mask with a bad name; mask in another folder | one each | rebuilt |
| schema; `sourceKey`; no `artifactDigests`; digest differs | one each | rebuilt |
| JSON broken; a listed file missing | one each | rebuilt |
| source changes while the cache is checked | `contentFileKey` stubbed to differ on its second call | falls through to a decode, which finds the change |
| bytes read differ from the key | `contentFileKey` stub | 'The template changed before its verified bytes were read…' |
| source changes during the backdrop | stub on the last call | 'The template changed while its backdrop was made…' |
| no layers | a PSD with no children | no pixels decoded, `frames: []` |
| CMYK with frames | header mode 4 | 'CMYK template frame masks cannot yet be verified…' |
| CMYK with no frames | one row | backdrop made |
| 16-bit with frames | one row | 'High-depth template frame masks cannot yet be verified…' |
| 16-bit with no frames | one row | backdrop made |
| hidden frame | one row | no mask file |
| frame over budget | `decodeEstimate` over the budget | `withPixels` false, no mask |
| `frameMask` returns 'stroke' | a frame with an inside stroke | `stroke.revealed` true |
| two callers at once | `Promise.all` | one build, the entry leaves `inflight` |
| `mask bytes` | a shaped frame | the mask PNG's hash |

- [ ] **Step 3: Marks and mutants**

```bash
$E/scripts/marks.sh test/psd_template_frames.test.js
export MUT_ALSO="test/template_color_edges.test.js test/template_freshness.test.js"
$E/scripts/mutants.sh collectFrames native/backend/lib/psd_template.js 84 test/psd_template_frames.test.js
$E/scripts/mutants.sh shapeAlpha native/backend/lib/psd_template.js 125 test/psd_template_frames.test.js
$E/scripts/mutants.sh templateArt native/backend/lib/psd_template.js 271 test/psd_template_frames.test.js
```

Expected: 51/51, 72/72 and 69/69. Each survivor gets a row or a reason.

- [ ] **Step 4: Commit the pins**

Message: `test: pin template frames, shapes and art`. Run `$E/scripts/commit.sh $E/logs/msg.txt native/backend/test/psd_template_frames.test.js`.
Expected: seven `ok` lines and the new commit.

- [ ] **Step 5: Split**

- `frameBox(n)`: returns `{ x, y, r, b }`, falling back to the mask's area.
- `frameRecord(n, orient, box, z, hidden)`: builds the frame and defines `node`.
- `applyPixelAlpha(out, f, n)` and `applyMaskAlpha(out, f, n)`: each one nested loop, each returns whether it shaped anything. `shapeAlpha` keeps `shaped` from both, calling the image helper first.
- `usableImage(img)` and `activeMask(m)`: predicates for the two entry conditions.
- `cachedArt(infoFile, dir, key, maxEdge, psdPath, sourceDigest)`: holds today's `try`/`catch`, so the swallowed throw stays swallowed (Ruling 11), and returns the art or null.
- `readTemplate(psdPath, key)`: reads the bytes and checks them; returns `{ buf, cmyk, metadata }`.
- `decodeLayers(ag, metadata, cmyk)`: returns `{ outline, psd, withPixels }`.
- `assertFramesSupported(cmyk, outline, frames)`.
- `writeFrameMasks(frames, withPixels, dir, maxEdge, scale)`.
- `writeBackdrop(source, art, dir, maxEdge, scale)`: keeps `cleanup` in the `finally`.
- The job becomes `(await cachedArt(...)) || (await buildArt(...))`. `psdPixels` still runs before the backdrop write, and the final `contentFileKey` check still comes after it.

- [ ] **Step 6: Compare old and new**

- `cmp-parsers.mjs` adds, seed 5601: `collectFrames` on 30,000 random trees, comparing the enumerable fields and `node` identity by position; `shapeAlpha` on 30,000 random frames, nodes and masks up to 12×12, comparing bytes; the predicates against the old conditions, copied verbatim.
- `$E/scripts/sweep-art.mjs`, using `sweep()`: scenarios are a first build, a cached read, a cached read with a stale digest and a build with a mask. Modes `once`, `stop` and `perturb` (the perturbation rewrites the PSD).

Run both, with logs in `$E/logs/`.
Expected: 0 differences. Prove each with 5 sampled mutants of the new code, each caught.

`timing.mjs`: `shapeAlpha` on a 3600×2400 image and mask, old against new.
Expected: new within 10% of old.

- [ ] **Step 7: Complexity, baseline, commit**

Expected: all three and every helper at 20 or less. Message: `refactor: split template frames, shapes and art`, with the comparison counts. Run `$E/scripts/commit.sh $E/logs/msg.txt native/backend/lib/psd_template.js native/scripts/readability-baseline.json`.
Expected: seven `ok` lines and the new commit.

---

### Task 7: Layer edits and overlays

**Files:**
- Create: `native/backend/test/parity_edits.test.js`
- Modify: `native/backend/lib/parity.js` (`applyLayerEdits`, `addOverlays`)

**Interfaces:**
- Consumes: `loadPrivate`.
- Produces: unchanged `applyLayerEdits(pc, templatePath, layerEdits) → warnings` and `addOverlays(pc, overlays, { width, height, tplIdx }) → warnings`.

- [ ] **Step 1: Pin `applyLayerEdits`**

A real small PSD gives the outline. `fakePc(script)` records `call` and `run` and can fail any operation:

```js
function fakePc({ doc, fail = {}, answers = {} }) {
  const calls = []
  const act = async (op, params) => {
    calls.push([op, params])
    if (fail[op]) throw fail[op] === true ? new Error(`${op} failed`) : fail[op]
    return answers[op] ?? {}
  }
  return { calls, call: (op, params) => (op === 'doc.inspect' ? (calls.push([op, params]), doc) : act(op, params)), run: act }
}
```

| Row | Edit | Expected |
|---|---|---|
| null; `{}` | as `layerEdits` | `[]`, no calls |
| `resolution` 0 or missing | with a text style size | 72 used |
| no children in the outline | `{ '0': {} }` | the 'wasn't found' warning, with the id |
| layer paired on one side only | a pair with no engine layer | the warning with the name |
| `hidden` same as the layer's; different | one each | no call; `layer.setProps` `visible` |
| `opacity` within 0.001; different; layer opacity missing | one each | no call; call; compared with 1 |
| text same; text changed, with `\r\n`; text on a non-text layer; non-string | one each | none; `type.edit` with `\n`; none; none |
| `textStyle` on a non-text layer | one row | none |
| `sizePx` 0, 24; colour `#112233`, `red`, number | one each | `type.setStyle` only with valid fields; none if empty |
| `font` | one row | the font warning, after any restyle |
| no move | sx 1, sy 1, no dx or dy | no later call |
| `dx` string number; `dy` only; `sx` non-number | one each | numeric; moves; 1 |
| bounds given; missing | one each | `layer.bounds`; `agBox` |
| text move; `info.transform` missing | one each | `type.edit` with the exact matrix, default matrix |
| raster move, fractions | one row | `layer.translate`, rounded |
| raster resize, `sx` only, `sy` only | one each | `edit.transform` with the exact rect and quad |
| each step fails | one each | that warning, later steps still run |
| failure value with no message | fail with a string | the string in the warning |
| several edits | two layers | in `Object.entries` order |

- [ ] **Step 2: Pin `addOverlays`**

Load with stubs for `../../../src/overlay_render`, `../../../src/overlay_ps` and `../../../src/proof_renderer`, so each `resolveTextLayout` and `rasterizeOverlays` answer is set by the row.

| Row | Overlays | Expected |
|---|---|---|
| not an array; empty; all hidden; only null | one each | `[]`, no `doc.inspect` |
| `resolution` 0 | one row | 72 used |
| no shapes | text only | no shape steps |
| shapes, `rasterizeOverlays` null | one row | no open, no unlink |
| shapes | one row | the exact call order, PNG unlinked |
| top is null; top is the new layer; top differs | one each | no move; no move; `layer.moveTo` |
| a shape step fails | each of the seven calls | the warning, PNG unlinked |
| unlink fails | one row | swallowed |
| null, hidden and non-text overlays | one row | skipped |
| `resolveTextLayout` null | one row | skipped |
| no first line | `lines: []` | name 'Text' |
| long first line | one row | 40 characters |
| align `center`, `right`, `left`, other | one each | passed, or 'left' |
| `italic`, `underline` | truthy; falsy | booleans |
| `trackingEm` 0.05; missing | one each | rounded; 0 |
| colour `#AABBCCDD`; `red` | one each | first 7 characters; '#111111' |
| opacity 0.5; 1 | one each | `layer.setProps`; none |
| `rot` 30; 0 | one each | `type.edit` with the exact matrix; none |
| top null; same; differs | one each | as above |
| a text step fails | one row | the warning, the next text still placed |

- [ ] **Step 3: Marks and mutants**

```bash
$E/scripts/marks.sh test/parity_edits.test.js test/parity.test.js
$E/scripts/mutants.sh applyLayerEdits native/backend/lib/parity.js 79 test/parity_edits.test.js test/parity.test.js
$E/scripts/mutants.sh addOverlays native/backend/lib/parity.js 185 test/parity_edits.test.js test/parity.test.js
```

Expected: 97/97 and 61/61. Each survivor gets a row or a reason.

- [ ] **Step 4: Commit the pins**

Message: `test: pin layer edits and page overlays`. Run `$E/scripts/commit.sh $E/logs/msg.txt native/backend/test/parity_edits.test.js`.
Expected: seven `ok` lines and the new commit.

- [ ] **Step 5: Split**

- `applyVisibility`, `applyOpacity`, `applyTextEdits`, `styleParams(st, ppi)` and `applyPlacement`, each taking `(pc, target, edit)`, where `target` is `{ ag, layer, id, isText, step, warnings, ppi }`. `applyLayerEdits` builds `target`, then awaits them in today's order. The `continue` after the no-move check becomes a `return` in `applyPlacement`.
- `addShapes(pc, overlays, { width, height, tplIdx }, warnings)`: keeps its `try`, `catch` and `finally`.
- `addTextOverlay(pc, L, width, height, ppi, warnings)`, `typeParams(t, name, ppi)` and `turnType(pc, id, t)`.
- `moveToTop(pc, id)`: used by both, since both make the same two checks and call.

- [ ] **Step 6: Compare old and new**

`$E/scripts/cmp-parity.mjs`, seed 5701: `compareAsync` on 20,000 random edit maps and 20,000 random overlay lists, with a fake `pc` built per call that fails each operation at random, comparing the warnings and the full call log. `styleParams`, `typeParams` and the predicates each get 20,000 random inputs against the old expressions, copied verbatim.

Run: `node $E/scripts/cmp-parity.mjs | tee $E/logs/cmp-parity.txt`
Expected: 0 differences. Prove it with 10 sampled mutants of the new code, each caught.

- [ ] **Step 7: Complexity, baseline, commit**

Expected: both functions and every helper at 20 or less. Message: `refactor: split layer edits and page overlays`, with the comparison counts. Run `$E/scripts/commit.sh $E/logs/msg.txt native/backend/lib/parity.js native/scripts/readability-baseline.json`.
Expected: seven `ok` lines and the new commit.

---

### Task 8: `preflightAlbum`

**Files:**
- Create: `native/backend/test/preflight_fixture.js`, `native/backend/test/preflight_checks.test.js`
- Modify: `native/backend/test/preflight.test.js` (imports the moved helpers), `native/backend/lib/preflight.js`

**Interfaces:**
- Consumes: `loadPrivate`, `collectFrames` from Task 6.
- Produces: unchanged `preflightAlbum(album, ws, settings, requestedSpreads, expectedInputs) → report`. It's called by `render.js` (Task 10) and `deliver.js` (Task 11).

- [ ] **Step 1: Move the fixture**

Move `pixels`, `frame`, `fixture`, `codes` and `run` from `preflight.test.js` into `preflight_fixture.js` unchanged. Run: `cd $R/native/backend && node --test test/preflight.test.js`
Expected: the same pass count as before.

- [ ] **Step 2: Pin the opening checks and one spread's inputs**

Rows assert `codes(report)` exactly. Where a row needs a tree a real PSD can't hold, `t.mock.method(ag, 'readPsd', () => tree)` (Ruling 10). Where it needs a stubbed collaborator, `loadPrivate('../lib/preflight.js', { stubs })`.

| Row | Change | Expected |
|---|---|---|
| `requestedSpreads: 'x'` | one row | `spread_selection_invalid` |
| empty; repeated; 1.5; unknown | one each | the same |
| spec width 0; height 0; `bleedInches` -1; `safeInches` -1; `gutterInches` -1 | one each | `lab_spec_invalid`, and no `lab_dimensions_mismatch` for 0 |
| `bleedInches` undefined | one row | no failure |
| spec holding `NaN` | one row | `lab_spec_invalid` |
| profile `AdobeRGB`; `sRGB`; `s-rgb`; `SRGB`; none | one each | `lab_profile_unsupported`; none |
| `expectedInputs` empty Map | one row | falls back to `spreadInputs` |
| `spreadInputs` throws | a photo whose original is a folder | `source_changed`, then the next spread runs |
| conflict `{ n: 1 }`; `{ n: 2 }` | one each | `identity_conflict`; none |
| `{ id: 'photoA' }`; `{ id: 'x', candidates: ['photoA'] }` | one each | `identity_conflict` |
| `{ id: 'templateA' }`; `{ id: 'x', candidates: ['templateA'] }` | one each | `identity_conflict` |
| `{ id: 'x' }`; `identityConflicts` undefined | one each | none |
| a conflict on a spread with no template | one row | `template_missing` only |
| two spreads on one template | one row | one decode (`readPsd` call count) |
| wrong template digest | `expectedInputs` | `template_corrupt`, 'changed before…' |
| 16000 × 16000 header | built document | `template_corrupt`, 'exceeds the full geometry-decode budget' |
| layer pushing the budget over | mocked tree | the same |
| node with no bounds | mocked tree, budget `NaN` | the same |
| width 0; width `NaN` | mocked tree | `template_corrupt`, 'Invalid template dimensions.' |
| huge `ppi` | `settings` | `print_settings_invalid` with the spread's `n` |
| `size: 'original'` | one row | inches from `psd.height / ppi` |
| right height, wrong width | spec | `lab_dimensions_mismatch` |

- [ ] **Step 3: Pin layer edits and frames**

`pageLayerEdits[1]` rows, on a PSD with a group, a frame and a plain layer:

| Row | Edit | Expected |
|---|---|---|
| `null`; `'x'`; `{ sx: 0 }`; `{ sy: -1 }`; `{ dx: NaN }`; `{ opacity: 2 }`; `{ opacity: -1 }`; `{ hidden: 'x' }` | one each | `layer_edit_invalid` |
| `{ opacity: 0 }`, `{ opacity: 1 }` | one each | accepted |
| unknown id | `{ '9': {} }` | `layer_geometry_unverified` |
| group `{ dx: 0 }`; `{ sx: 1 }` | one each | none |
| group `{ dx: 5 }`; `{ sx: 2 }` | one each | `layer_geometry_unverified` |
| `{ textStyle: { font: 'x' } }`; `{ textStyle: {} }` | one each | `unsupported_edit`; none |
| frame `{ dx, dy, sx, sy }` | one each | the moved frame shows in `effective_ppi` |
| frame `{ hidden: true }`; `{ opacity: 0.5 }`; `{ opacity: 0 }` | one each | `frame_hidden`; none; `frame_hidden` |

Frame rows, on mocked trees where needed:

| Row | Frame | Expected |
|---|---|---|
| hidden parent; shown by an edit under a hidden parent | one each | `frame_hidden` |
| parent opacity 0; node opacity undefined | one each | `frame_hidden`; none |
| no pixels, no mask; mask disabled; mask with no pixels | one each | `frame_geometry_unverified` |
| pixels and a mask with no pixels | one row | pixels decide |
| fill layer, zero width; zero height | one each | area from the mask |
| mask `positionRelativeToLayer` true; false; `left` and `top` missing | one each | exact bounds in `effective_ppi` |
| `defaultColor` 255; missing | one each | outside the mask counts; doesn't |
| fully transparent | one row | `frame_empty`, and no `effective_ppi` |
| one opaque pixel in each corner | four rows | the exact tightened frame |

- [ ] **Step 4: Pin the photos and final checks**

| Row | Change | Expected |
|---|---|---|
| more photos than frames; fewer | one each | `photo_unplaced`; `frame_unfilled` |
| photo with no `base` | each message that names it | uses the id |
| missing original | one row | `missing_original`, the next photo still checked |
| rotation `'x'`; `NaN` | one each | `photo_edit_invalid` |
| `scale: 0.5`; `scale: 'x'`; `ox: 2`; `oy: 'x'` | one each | `photo_edit_invalid` |
| `exposure: 101`; `-101`; `'x'`; `bw: 'x'` | one each | `photo_edit_invalid` |
| `exposure: 100`; `bw: true` | one each | accepted |
| `curves: true`; `curves: false` | one each | `unsupported_edit`; none |
| `vignette: 10`; `vignette: 0` | one each | `unsupported_edit`; none |
| no entry in `expectedInputs[2]`; another file | one each | `photo_corrupt`, 'no longer matches…' |
| wrong photo digest | `expectedInputs` | `photo_corrupt`, 'changed before…' |
| `outputToken` missing | one row | `exports` folder used |
| EXIF orientations 5, 6, 7, 8, 1 | one each | width and height swapped, or not |
| metadata width `NaN`; 0 | stubbed sharp | `photo_corrupt`, 'Invalid source dimensions.' |
| two photos sharing one file | one row | one decode |
| `phase: 'export'` | one row | `embeddedPpi: null`, final warning |
| `phase: 'render'` | one row | `embeddedPpi` a number |
| `embeddingScale` given; undefined | one each | used; canvas scale |
| `minEffectivePpi` just above; exactly at | one each | `low_effective_ppi`; none |
| rotated so a corner shows | one row | `frame_coverage` |
| rotation with cover | one row | none |
| album photo missing | one row | `photo_missing`, once per id |
| template changes during verification | `fileDigest` stub | `source_changed`, 'the template changed' |
| photo changes during verification | `fileDigest` stub | `source_changed`, 'photo … changed' |
| photo with no file in inputs | one row | skipped |
| `verified_input_revisions` | the clean run | exact `templateDigest` and `photos` |
| `one album breaking many rules reports them in order` | two spreads, covering conflict, lab dimensions, layer edit, frame, photo, final and the second spread's issues | the full list of `errors`, `warnings` and `info` codes in order |

- [ ] **Step 5: Marks and mutants**

```bash
$E/scripts/marks.sh test/preflight_checks.test.js test/preflight.test.js
$E/scripts/mutants.sh preflightAlbum native/backend/lib/preflight.js 51 test/preflight_checks.test.js test/preflight.test.js
```

Expected: 408/409, its one miss in Ruling 4. Each survivor gets a row or a reason.

- [ ] **Step 6: Commit the pins**

Message: `test: pin every preflight check`. Run `$E/scripts/commit.sh $E/logs/msg.txt native/backend/test/preflight_fixture.js native/backend/test/preflight_checks.test.js native/backend/test/preflight.test.js`.
Expected: seven `ok` lines and the new commit.

- [ ] **Step 7: Split `preflightAlbum`**

A `check` object carries `{ album, ws, settings, expectedInputs, add, fail, minimum, spec, photoCache, templateCache }`. Each `continue` becomes a `return`.

- `invalidPrintSettings(settings, minimum)`, `invalidSelection(album, requested)`, `invalidLabSpec(spec)`: predicates.
- `checkLabSpec(spec, check)`: the warnings and failures, in today's order.
- `checkSpread(sp, check)`: one pass of today's outer loop.
- `checkIdentityConflicts(sp, check)`, with the predicate `conflictAffects(c, sp, ids)`.
- `decodedTemplate(sp, inputValues, check)`: returns the PSD or null after failing, with today's one `try`. It holds `decodeTemplate(file, digest)` and `geometryBudget(outline)`.
- `labDimensionsDiffer(spec, inches, psd)`: predicate.
- `layerModel(psd, layerEdits)`: returns `{ frames, nodes, nodeIds }`.
- `checkLayerEdits(sp, layerEdits, model, check)`, with `invalidLayerEdit(edit)`, `movesGroup(node, edit)` and `applyFrameEdit(f, edit)`.
- `checkFrame(sp, f, layerEdits, model, check)`, with `inheritFrameState(f, layerEdits, model)` and `opaqueBounds(img, mask, area)`, which keeps the pixel loop whole, returning `{ ax, ay, bx, by }`.
- `checkOrientation(sp, orient, frames, psd, inches, canvas, inputValues, check)`.
- `checkPhotoPlacement(...)`, with `photoEdits(ws, id)`, `invalidPhotoEdit(edits)`, `checkAdjustments(sp, adjust, check)`, `photoDimensions(...)`, `reportResolution(...)` and `coversFrame(f, transform, meta, rotation)`.
- `verifyRevisions(sp, inputValues, check)`.

`preflightAlbum` keeps the report, the opening checks, the loop and the final warning. `frames` keeps its `{ ...f, node: f.node }` copy, which `collectFrames`' non-enumerable `node` needs.

- [ ] **Step 8: Compare old and new**

- `$E/scripts/cmp-preflight.mjs`, seed 5801: a shared read-only set of small real files, built once in `$S/preflight-files/`: PSD variants with masks, hidden layers, opacity, groups and fill layers, a corrupt PSD, JPEGs in both orientations with EXIF rotations, and a corrupt JPEG. `compareAsync` on 5,000 random `(album, ws, settings, requested, expectedInputs)` built from them, breaking one rule per input (about 85%) or none, and a further 1,000 breaking two. It compares the whole report and, through `sweep.mjs`'s hooks, the file-call log.
- Each predicate gets 20,000 random inputs against the old condition, copied verbatim from base: `invalidPrintSettings`, `invalidSelection`, `invalidLabSpec`, `conflictAffects`, `labDimensionsDiffer`, `invalidLayerEdit`, `movesGroup`, `invalidPhotoEdit` and `coversFrame`.
- `opaqueBounds` gets 20,000 random small images and masks against the old loop, copied verbatim.
- `$E/scripts/sweep-preflight.mjs`, using `sweep()`: one album of two spreads, modes `once` and `perturb` (the perturbation edits a photo).

Run them, with logs in `$E/logs/`.
Expected: 0 differences. Prove each with 10 sampled mutants of the new code, each caught.

`timing.mjs`: `preflightAlbum`'s frame check on a 3600×2400 frame with a mask, old against new.
Expected: new within 10% of old.

- [ ] **Step 9: Complexity, baseline, commit**

Expected: `preflightAlbum` and every helper at 20 or less. Message: `refactor: split preflightAlbum into its checks`, with the comparison counts. Run `$E/scripts/commit.sh $E/logs/msg.txt native/backend/lib/preflight.js native/scripts/readability-baseline.json`.
Expected: seven `ok` lines and the new commit.

---

### Task 9: Proof drawing and refresh planning

**Files:**
- Create: `native/backend/test/proofs_draw_paths.test.js`, `native/backend/test/proofs_refresh_plan.test.js`
- Modify: `native/backend/lib/proofs.js` (`draw`, `prepareRefresh`)

**Interfaces:**
- Consumes: `loadPrivate`, `collab`, Task 2's stacking pins.
- Produces: unchanged `drawProof(spread, album, ws, out, options)` and private `prepareRefresh(albumPath, projectText, targets) → { album, ws, projectText, todo, reuse, removed }`.

- [ ] **Step 1: Pin `draw`**

`loadPrivate('../lib/proofs.js', { stubs })`, with `./psd_template`'s `templateArt` answering by row, and real sharp on small images.

| Row | Setup | Expected |
|---|---|---|
| art `sourceKey` differs | one row | 'The template changed before its proof snapshot was made.' |
| art with a backdrop; no backdrop but a preview; neither, with a background; neither, no background | one each | `proof bytes`: the output hash, and the base colour |
| invalid background colour | one row | white |
| mask on a frame; none | one each | mask snapshotted; not |
| photo gone from the album | one row | skipped, its frame keeps the template |
| `src.sourceKey` differs, via `original`; via `thumb` | one each | 'The photo changed before its proof snapshot was made.' |
| no `sourceKey` | one row | no check |
| `src.digest` missing | one row | `expected` used for the snapshot |
| placement, adjustment, rotation | given; missing | passed through |
| `pageOverlays`, `pageBackgrounds` | given; missing | used; defaults |
| layer edits, tree ok; tree not ok; `tree` null | one each | `psdLayers` set; null; null |
| layer edits with a backdrop; with a preview | one each | `templatePreviewPath` |
| `r.ok` false | one row | throws `r.error` |
| `r.skipped` given; missing | one each | the messages; `[]` |
| `buffered` with layer edits | one row | falls back to the unbuffered path |
| `buffered`, no edits | one row | returns `jpeg`, nothing written |
| hidden frame | one row | no layer |
| `frame.mask` | one row | `dest-in` composite, exact bytes |
| `frame.opacity < 1`; 1 | one each | alpha set; none |
| stroke not revealed; revealed; none | one each | stroke layer; none; none |
| `clipToCanvas` returning null for the stroke | a stroke off the canvas | `filter(Boolean)` drops it |
| a photo layer fails | one row | in `skipped`, others drawn |
| more than three frames | seven | all drawn, in order |
| overlays give an SVG; none | one each | composited; none |
| no layers | one row | the base alone |
| rename fails | a file at `out` | the error; the stage retires |

- [ ] **Step 2: Pin `prepareRefresh`**

`loadPrivate('../lib/proofs.js', { names: ['prepareRefresh'], stubs })`, with stubs for `./album`, `./inputs`, `./output_paths`, `./sheets` and `./render_inputs`, and a real temporary album folder holding the manifest and proof files. Each row asserts `todo` (as `{ n, remove, hash, fromSheet, sheetDigest }`), `reuse` keys and `removed`.

| Row | Setup | Expected |
|---|---|---|
| null entry; entry with no hash | manifest | ignored |
| entry with no id | manifest | not in `byId` |
| `targets` set | one row | only those spreads |
| no template, an entry; no entry, `s.proof` is its path; neither | one each | remove; remove; nothing |
| current, same id, digest matches | one row | nothing |
| current, no id, not a sheet; no id, a sheet | one each | nothing; todo |
| current, no `digest`; digest differs | one each | todo |
| those, `source: 'sheet'` with `s.sheet`; without | one each | `fromSheet` set; not |
| current sheet proof, sheet digest changed; path moved; same | one each | `fromSheet`; `fromSheet`; nothing |
| not current, template on disk; not on disk | one each | todo; nothing |
| same picture by id; by hash | one each | `reuse` holds it |
| id's hash differs, hash match elsewhere | one row | `reuse` from the hash match |
| from a sheet, path differs with `s.sheet`; without; digest differs; same | one each | `fromSheet`; nothing; `fromSheet`; continues to reuse |
| proof file missing; bytes don't match | one each | no `reuse` |
| `from` is itself | one row | not reused; checks the sheet |
| sheet record verified and hash matches; unverified; hash differs | one each | `fromSheet`; nothing; nothing |
| `n` past the album's end | manifest | in `removed` |
| `t.inputs`, `t.previous` | any todo | set |

- [ ] **Step 3: Marks and mutants**

```bash
$E/scripts/marks.sh test/proofs_draw_paths.test.js test/proofs_refresh_plan.test.js test/proofs.test.js
MUT_ALSO="test/proofs.test.js" $E/scripts/mutants.sh draw native/backend/lib/proofs.js 313 test/proofs_draw_paths.test.js
MUT_ALSO="test/proofs.test.js" $E/scripts/mutants.sh prepareRefresh native/backend/lib/proofs.js 648 test/proofs_refresh_plan.test.js
```

Expected: 119/119 and 112/112. Each survivor gets a row or a reason.

- [ ] **Step 4: Commit the pins**

Message: `test: pin proof drawing and refresh planning`. Run `$E/scripts/commit.sh $E/logs/msg.txt native/backend/test/proofs_draw_paths.test.js native/backend/test/proofs_refresh_plan.test.js`.
Expected: seven `ok` lines and the new commit.

- [ ] **Step 5: Split**

- `frozenArt(spread, inputValues, sourceStage, buffered)`: `templateArt`, the key check, then the backdrop and mask snapshots, in that order.
- `frozenPhotos(spread, album, ws, inputValues, sourceStage, buffered)`: builds `dirs` and the list.
- `drawLayeredProof(...)`: today's layer-edits branch. It reads `template` from `draw`, which snapshotted it before `templateArt` ran.
- `proofBase(sharp, pr, backdrop, W, H, background)`.
- `drawFrames(sharp, pr, pairs, dims, W, H)`: returns `{ layers, skipped }`, with `renderFrame` inside and the three-at-a-time batching.
- `writeProof(base, layers, sharp, out, sourceStage, buffered, skipped)`.
- `knownPictures(known)`: returns `{ byHash, byId }`.
- `refreshTodo(s, e, hash, album)`: returns the entry or null.
- `settleTodo(t, known, byId, byHash, album, ws, reuse)`: one pass of today's `reuse` loop. The `continue` becomes a `return`, and `require('./sheets')` stays lazy.

- [ ] **Step 6: Compare old and new**

`$E/scripts/collab-proofs.mjs`, using `collab()`:
- `prepareRefresh`: `real: { path: true, crypto: true, fs: ['writeFileSync'], './cache': ['contentKey', 'cacheRoot'] }`. 60 seeded scenarios choose, per spread, the template, manifest entry, digests, sheet record and which proof files exist. `spec.flip` changes digest strings and records.
- `draw`, through `drawProof`: 30 seeded scenarios choosing art, photos, edits and frames, with `sharp` faked as a recording chain.

`$E/scripts/sweep-proofs.mjs`, using `sweep()` with real sharp: an unbuffered flat page, a layered page and a page with a mask, modes `once` and `stop`. Each clean run compares the proof's bytes.

`cmp-parsers.mjs` adds `knownPictures` on 20,000 random manifests.

Run them, with logs in `$E/logs/`.
Expected: 0 differences. Prove each with 10 sampled mutants of the new code, each caught. Run `collab-proofs.mjs` once with `roots.old` set to `$S/marked-4b3`, then the report, to see what the scenarios reached; add a scenario for any outcome they missed.

- [ ] **Step 7: Complexity, baseline, commit**

Expected: both functions and every helper at 20 or less. Message: `refactor: split proof drawing and refresh planning`, with the comparison counts. Run `$E/scripts/commit.sh $E/logs/msg.txt native/backend/lib/proofs.js native/scripts/readability-baseline.json`.
Expected: seven `ok` lines and the new commit.

---

### Task 10: `runJob`

**Files:**
- Create: `native/backend/test/render_job.test.js`
- Modify: `native/backend/lib/render.js` (`runJob`)

**Interfaces:**
- Consumes: `loadPrivate`, `collab`, `preflightAlbum`.
- Produces: unchanged private `runJob(job, { album, ws, projectText, spreads, settings, lease, force, overwriteEdited }, emit) → results`.

- [ ] **Step 1: Write the harness**

`render_job.test.js` gets `runJob` through `loadPrivate('../lib/render.js', { names: ['runJob'], stubs })`. `harness(overrides)` stubs `./sheets`, `./inputs`, `./render_inputs`, `./render_transaction`, `./project_transaction`, `./photocraft`, `./proofs`, `./parity`, `./raw`, `./sheet`, `./preflight`, `./private_stage`, `./print_settings`, `./cache`, `child_process` and `fs`. A clean spread renders with each answer in a plain table, and each row overrides what it needs. It returns `{ runJob, job, events, calls, options }`. Assert results, job counters, events and `finishingErrors`; assert calls only where the call is the behaviour, such as a stage cleanup.

- [ ] **Step 2: Pin the per-spread paths**

| Row | Change | Expected |
|---|---|---|
| no template; template with no file | one each | failed, 'the spread has no template'; failed, "the template T isn't on disk" |
| no photos | one row | failed, 'the spread has no photos' |
| owned sheet elsewhere, a file at the output path | one row | failed, 'An unowned sheet exists at …' |
| no record, a file at the output path | one row | the same |
| edited sheet | digest differs | skipped, `reason: 'edited'` |
| unverified record | `verifiedSheetRecord` false | skipped, 'edited' |
| edited, `overwriteEdited` | one row | rendered |
| verified, hash same, resolution fine | one row | skipped, no reason |
| `force`; hash differs; resolution short | one each | rendered |
| string cache entry | old format | `entryHash` reads it |
| preflight errors | two | failed, joined with a space |
| photo missing; no original | one each | failed, 'The original photo … is missing…' |
| developed key differs; adjusted key differs | one each | failed with each message |
| orient `v`; rotation; placement | given; missing | passed to `buildSheet` |
| layer edits; overlays | given; missing | passed, or null |
| second spread | two spreads | one session |
| `built.warnings` | one row | failed, 'Sheet construction left edits…' |
| `validateSnapshot`: project text differs; spread hash differs; private file differs; stage changed | one each, called by the fake `publishRender` | failed with each message |
| `a failure after commit reports the saved sheet` | `renderCommitted` with `cache`, `cacheRevision` and a matching `sheetRecord` | done, committed, warning naming recovery history |
| each field missing; `sheetRecord.path` differs | five rows | failed, the error rethrown |
| proof step fails: `sips`; digest; register; `recordSheetProof` | one each | done, the 'saved, but its preview…' warning, the cache advanced |
| clean | one row | the exact `render.progress` and `proofs.updated` events, `done` result |
| warnings | a vignette | in the result |
| cancelled during publish | `RENDER_CANCELLED` | cancelled result, the loop stops, the stage retires |
| cancelled with `recoveryRequired` | one row | failed, the loop goes on |
| `job.cancelled` before a spread | one row | stops before it |
| thrown string; thrown `0`; thrown `''` | one each | failed, `String(e)` |
| `a failed spread doesn't stop the next one` | two spreads, first fails | one failed, one done |
| dead engine | `proc.exitCode` 1 | next spread gets a new session, `closeAll` not called |
| live engine after a failure | one row | `closeAll` called, session kept |
| no engine yet | fails before building | neither |
| `closeAll` rejects | one row | the job rejects, the stage retires first |
| `cleanup` fails | one row | in `finishingErrors`, the result stands |
| no stage | fails before it's made | no cleanup |

- [ ] **Step 3: Pin the job's edges**

| Row | Change | Expected |
|---|---|---|
| `a sheet-record failure ends the job` | `ownedSheetRecord` rejects | `runJob` rejects, no result for that spread, the session closes |
| `canonicalSheetPath` throws | one row | the same |
| cache version 1; version 2 | one each | starts empty; kept |
| `cache.albumFile` | any | set |
| `assertOwned` fails at the job's start | one row | rejects, nothing made |
| `assertOwned` fails in a spread | one row | that spread fails |
| close fails | one row | in `finishingErrors`, results returned |
| no session | all skipped | no close |
| cache advances | two spreads | the second's `cacheBefore` is the first's revision |

- [ ] **Step 4: Marks and mutants**

```bash
$E/scripts/marks.sh test/render_job.test.js
MUT_ALSO="test/render_finish.test.js test/render_private_stage.test.js" $E/scripts/mutants.sh runJob native/backend/lib/render.js 170 test/render_job.test.js
```

Expected: 143/143. Each survivor gets a row or a reason.

- [ ] **Step 5: Commit the pins**

Message: `test: pin every path of a render job`. Run `$E/scripts/commit.sh $E/logs/msg.txt native/backend/test/render_job.test.js`.
Expected: seven `ok` lines and the new commit.

- [ ] **Step 6: Split `runJob`**

A `run` object carries `{ job, album, ws, projectText, settings, lease, force, overwriteEdited, emit, paths, proofDir, pc, cache, cacheRevision }`. A `work` object carries one spread's `{ s, i, name, record, existingPath, outPsd, report, t0, sourceStage, privateStage, publication, privateFiles }`.

- `renderSpread(run, s, i)`: returns `'stop'` to end the loop. **`ownedSheetRecord`, `canonicalSheetPath` and `outputName` stay before its `try`, so their errors still escape the loop.** The body is:

```js
  try {
    return await renderSheet(run, work)
  } catch (e) {
    return await spreadFailed(run, work, e)
  } finally {
    await retireRenderStage(run, work)
  }
```

  Both `return await`s are needed: without them `finally` would run before the helper ends, and `closeAll` would race the cleanup.
- `renderSheet(run, work)`: the checks up to `report('preparing')`, then the rest through helpers. Each `continue` becomes a `return`.
- `assertRenderable(s)`, `editedSheet(record, existingBefore, overwriteEdited)`, `sheetIsCurrent(run, work, existingBefore, hash)`, `spreadSkipped(run, work, extra = {})`.
- `freezePhotos(run, work, inputValues)`: the photo loop.
- `buildStagedSheet(run, work, template, photos)`: `report('building')`, the session and `buildSheet`.
- `snapshotValidator(run, work, hash, stagedPsd)`: returns `validateSnapshot`.
- `cacheWithSheet(run, work, hash, preflight)`.
- `publishSheet(run, work, request, committedWarnings)`: the committed-error branch, with the predicate `committedWithoutHistory(error, outPsd)`.
- `refreshSheetProof(run, work, ...)`: its own `try`.
- `spreadFailed(run, work, e)`: returns `'stop'` when cancelled.
- `retireRenderStage(run, work)`, `closeRenderSession(run)`.

`runJob` keeps its setup, the loop (`if (job.cancelled) break`, then `if ((await renderSpread(run, spreads[i], i)) === 'stop') break`), the outer `finally` and `return results`.

- [ ] **Step 7: Compare old and new**

`$E/scripts/collab-render.mjs`, using `collab()` with `names: ['runJob']`, `real: { path: true, crypto: ['createHash'], fs: ['writeFileSync'], './cache': ['contentKey'] }` and `file: 'native/backend/lib/render.js'`:
- Errors: a plain error; `RENDER_CANCELLED`; `RENDER_CANCELLED` with `recoveryRequired`; a `renderCommitted` error whose fields match; one whose path doesn't.
- `publishRender`'s answer calls its hooks in today's order, then returns or throws.
- 80 seeded scenarios choose 1–3 spreads and, for each, the record, digests, flags, photos, warnings, and whether the engine dies. `ctx.cancel()` sets `job.cancelled`, and `ctx.state()` is the job plus results, events and `finishingErrors`.

`cmp-parsers.mjs` adds `editedSheet` and `committedWithoutHistory`, each on 20,000 random inputs against the old condition, copied verbatim.

Run: `node $E/scripts/collab-render.mjs | tee $E/logs/collab-render.txt`
Expected: 0 differences. Prove it with 15 sampled mutants of the new code, including one moving `ownedSheetRecord` inside the `try` and one dropping a `return await`, each caught. Run it once with `roots.old` set to `$S/marked-4b3` and add scenarios for any outcome missed.

The real-engine tests in `render_finish.test.js` run in the gate.

- [ ] **Step 8: Complexity, baseline, commit**

Expected: `runJob` and every helper at 20 or less. Message: `refactor: split runJob into per-spread steps`, with the comparison counts. Run `$E/scripts/commit.sh $E/logs/msg.txt native/backend/lib/render.js native/scripts/readability-baseline.json`.
Expected: seven `ok` lines and the new commit.

---

### Task 11: `runExport`

**Files:**
- Create: `native/backend/test/deliver_job.test.js`
- Modify: `native/backend/lib/deliver.js` (`runExport`)

**Interfaces:**
- Consumes: `loadPrivate`, `collab`.
- Produces: unchanged private `runExport(job, prepared, emit)`.

- [ ] **Step 1: Pin `runExport`**

`harness(overrides)` stubs `./private_stage`, `./delivery_transaction`, `./pdf`, `./jobs`, `./sheet`, `./render_inputs`, `./cache` and `fs`. `withPrivateStage` answers with a size such as `{ width: 10, height: 10 }` without calling its callback, or rejects for a failed sheet, because `exportSheet` is local to the module and the existing `deliver.test.js` runs it for real. Assert the final `export.finished` event in full, plus `export.progress` events in order.

| Row | Change | Expected |
|---|---|---|
| clean, two sheets | one row | exact events, `done` 2, `publishDelivery` given both targets |
| ready sheet, no `force`; with `force` | one each | skipped; exported |
| cancelled before a sheet | one row | stops, no PDF, no publish, `cancelled: true` |
| cancelled at the end | one row | `return` runs `finally`, the stage is cleaned |
| `a failed sheet ends the export` | `exportSheet` rejects on the first of two | `failed: 1`, no second sheet, the stage is cleaned |
| PDF wanted, all pages known | one row | `state: 'pdf'` event, `pdf` result |
| PDF wanted, a page missing | one row | 'The review JPEGs are incomplete…' |
| no PDF wanted | one row | `pdf: null` |
| PDF wanted and failed | one row | `pdf: { error }` |
| required is the plan's spreads with a PDF; the chosen ones without | one each | `assertSnapshot` sees that list |
| ready sheet's high JPEG changed; low changed | one each | "Spread n's JPEGs changed during export." |
| a stale entry's file rewritten | `high`; `low`; both missing | entry removed; kept when no `e[k]` |
| a generated entry | one row | kept |
| `ownedFiles` | old entries with and without `high`, `low` | merged |
| `pdfResult` | one row | `next.pdf` set |
| `makeCache` and `validateSnapshot` hooks | called by the fake | order: `assertOwned`, `assertSnapshot`, `assertFiles` |
| cancel requested after commit | one row | `cancelled: false`, sheets done |
| failure after the transfer | one row | message gains 'Inspect prepared delivery work at …', no cleanup |
| `DELIVERY_CANCELLED`, no recovery | one row | `cancelled: true`, no `failed` |
| `DELIVERY_CANCELLED` with each of `recoveryStage`, `recoveryJournal`, `recoveryLock`, `snapshotPath`, `retainedPath` | five rows | counted as a failure |
| `a committed delivery with a recovery failure reports both` | `deliveryCommitted` | `cancelled: false`, sheets done, `finishingErrors`, the `warning` event, not failed |
| no prepared items, committed | one row | no done events |
| thrown value with no message | one row | `String(e)` |
| `createPrivateStage` fails; `mkdir` fails | one each | `stageCapability` null, no cleanup, failed |
| cleanup retains a path; returns none; throws | one each | the message; none; `cleanup.message` |
| job isn't `current` | any direct call | no effect on the event |
| release fails | one row | 'Delivery completed its file work…' |
| `error` and `finishingError` | both | joined in the event |

- [ ] **Step 2: Marks and mutants**

```bash
$E/scripts/marks.sh test/deliver_job.test.js
MUT_ALSO="test/deliver.test.js test/delivery_cleanup.test.js test/delivery_integrity.test.js" $E/scripts/mutants.sh runExport native/backend/lib/deliver.js 335 test/deliver_job.test.js
```

Expected: 102/104, its misses in Ruling 4. Each survivor gets a row or a reason.

- [ ] **Step 3: Commit the pins**

Message: `test: pin every path of an export job`. Run `$E/scripts/commit.sh $E/logs/msg.txt native/backend/test/deliver_job.test.js`.
Expected: seven `ok` lines and the new commit.

- [ ] **Step 4: Split `runExport`**

A `run` object carries `{ job, prepared, emit, next, results, files, review, pdfResult, stage, stageCapability, transactionOwnsStage, error }`.

- `openExportStage(run)`, `exportSpreads(run)` and `exportSpread(run, sp, i)`. The `report` and `continue` for a ready sheet stay together in `exportSpread`.
- `writeReviewPdf(run)`.
- `assertReadyUnchanged(cache, required)`.
- `retireReplacedEntries(run)`, `recordOwnedFiles(run)`. The no-op `continue` goes with the move, since a `continue` as a loop's last statement can't change behaviour; Ruling 11 records it if it's kept.
- `publishExport(run, required)`.
- `finishPrepared(run)`: the `prepared` → `done` loop, used by both the success and committed paths.
- `exportFailed(run, e)`: today's `catch`, with the predicate `needsRecovery(e)`. **The `lstat` stays, as a call.**
- `finishExport(run)`: today's `finally`.

`runExport`'s `try` keeps `if (want.pdf && !job.cancelled)` and `if (job.cancelled) return`.

- [ ] **Step 5: Compare old and new**

`$E/scripts/collab-deliver.mjs`, using `collab()` with `names: ['runExport']`, `file: 'native/backend/lib/deliver.js'`, `real: { path: true, crypto: true, fs: ['writeFileSync'] }`:
- Errors: a plain error; `DELIVERY_CANCELLED`; `DELIVERY_CANCELLED` with `recoveryStage`; `deliveryCommitted`; `deliveryCommitted` with `recoveryJournal`; an error with no message.
- `publishDelivery`'s answer calls `validateSnapshot`, then `makeCache`, then `isCancelled`, as the real one does.
- 80 seeded scenarios choose the spreads and their states, `want`, `force`, the plan and the cached records. `ctx.state()` is the job, events and the `next` cache that `makeCache` returned.

`cmp-parsers.mjs` adds `needsRecovery` on 20,000 random error objects against the old condition, copied verbatim.

Run: `node $E/scripts/collab-deliver.mjs | tee $E/logs/collab-deliver.txt`
Expected: 0 differences. Prove it with 15 sampled mutants of the new code, including one moving `transactionOwnsStage = true` before `transfer()`, each caught. Run it once with `roots.old` set to `$S/marked-4b3` and add scenarios for any outcome missed.

- [ ] **Step 6: Complexity, baseline, commit**

Expected: `runExport` and every helper at 20 or less. Message: `refactor: split runExport into its steps`, with the comparison counts. Run `$E/scripts/commit.sh $E/logs/msg.txt native/backend/lib/deliver.js native/scripts/readability-baseline.json`.
Expected: seven `ok` lines and the new commit.

---

### Task 12: Re-score, record, review

**Files:**
- Modify: `QUALITY_IMPROVEMENT_LOG.md`, `docs/superpowers/plans/2026-10-30-phase-4b3-rendering-colour-proofs.md`

**Interfaces:**
- Consumes: the logs in `$E/logs/`.

- [ ] **Step 1: Measure**

```bash
cd $R
node $E/scripts/complexity.mjs > $E/logs/complexity.tsv && wc -l $E/logs/complexity.tsv
$E/scripts/marks.sh 'test/*.test.js'
BIN="$R/native/dist/Album Studio Latest.app/Contents/Resources/bin"; export ALBUM_STUDIO_PHOTOCRAFT_CLI="$BIN/photocraft-cli" ALBUM_STUDIO_RENAME_CLI="$BIN/album-studio-rename-exclusive"
npm --prefix native/backend run test:coverage > $E/logs/coverage.txt 2>&1
tail -20 $E/logs/coverage.txt
```

Expected: 31 functions above 20, none from the 16; the marks report shows only Ruling 4's outcomes unhit; coverage at or above 94% and 88%.

- [ ] **Step 2: Update the log**

In `QUALITY_IMPROVEMENT_LOG.md`:
- Add a 4b-3 paragraph after 4b-2's: what was split, the measured marks before and after, the number of new tests, mutants run and caught, comparison and sweep counts, and any real bug found. State plainly what wasn't reached.
- Phase table: add `| 4b-3. Rendering, colour, PDF and proofs | Done <date> |`, and change the last row to `| 4b-4, 4b-5, 4c, 4d, 5–7 | Not started |`.
- Open items: remove the stacking-slot sentence that Task 2 answered, and keep the sentence on two frames with one name. Add the two oddities from Ruling 11.
- CI item: replace the stale last clause ("so no push has started CI there yet") with what run 41099409111 showed, since pushes now start CI.
- Re-score Testing and Readability from the measurements, and leave each at its present value if the measurement doesn't justify more. Readability stays at 7 until more of the 31 fall.
- Update the batch count: "31 of the 47 remain for batches 4b-4, 4b-5 and phase 5".

Update memory `quality-programme-evidence.md` to name `$E`.

- [ ] **Step 3: Commit the log and the plan**

Write the message `docs: record phase 4b-3` with the trailer, then run `$E/scripts/commit.sh $E/logs/msg.txt QUALITY_IMPROVEMENT_LOG.md docs/superpowers/plans/2026-10-30-phase-4b3-rendering-colour-proofs.md`.
Expected: seven `ok` lines and the new commit.

- [ ] **Step 4: One fresh reviewer**

Run the review package for `BASE..HEAD` and dispatch one fresh Opus reviewer with the package, this plan, the spec, the Review Focus verbatim and the ledger's `Ruling:` lines. Ask it to run its own mutants on the helpers rather than read them.

- [ ] **Step 5: One fix pass**

Sort the findings by what a person using the app gets. Critical and Important enter one fix pass: each fix has a test that fails first, then the whole suite and gate, committed on its own. Minors go to the ledger and the final message. Copy the ledger to `$E/workspace/` before the workspace goes.

- [ ] **Step 6: Report**

The final message lists "Rulings I made", each with its cost if wrong, and "Deferred minors". Ask before any push.
