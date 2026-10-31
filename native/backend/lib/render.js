// render.js — render jobs: an album's spreads built into print sheets by PhotoCraft.
//
// One job at a time (PhotoCraft sessions are heavy); spreads render one after another in a single
// session. Progress is pushed as events; the job can be cancelled between sheets. A sheet is
// skipped when nothing that goes into it changed since it was last rendered AND its file is still
// in the output folder (a deleted sheet always renders again).

'use strict'

const { execFile } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { fileDigest, contentKey } = require('./cache')
const { createPrivateStage } = require('./private_stage')
const { spreadInputs } = require('./inputs')
const { spreadHash, renderInputHash } = require('./render_inputs')
const { publishRender, fingerprintRenderFile } = require('./render_transaction')
const { revisionOf } = require('./project_transaction')
const { PhotoCraftSession } = require('./photocraft')
const { recordSheetProof, proofInputHash } = require('./proofs')
const { bakeAdjustmentsEvidence } = require('./parity')
const { placeableEvidence } = require('./raw')
const { buildSheet, closeAll, outputName } = require('./sheet')
const { migrateAlbum, withProjectLease } = require('./project')
const {
  canonicalSheetPath,
  outputFolder: outputOf,
  ownedSheetRecord,
  readRenderCache,
  readRenderCacheSnapshot,
  verifiedSheetRecord,
} = require('./sheets')
const { reserveJob, identifyJob, releaseJob, spreadSelection } = require('./jobs')
const { withProjectOutputs } = require('./output_lock')
const { preflightAlbum } = require('./preflight')
const { printSettings, meetsPrintResolution } = require('./print_settings')

let current = null // the running job

async function readProject(file) {
  return JSON.parse(await fs.promises.readFile(file, 'utf8'))
}

function cachePaths(outputFolder) {
  const dir = path.join(outputFolder, '.album-studio')
  return {
    dir,
    file: path.join(dir, 'render-cache.json'),
    raw: path.join(dir, 'raw'),
    adjusted: path.join(dir, 'adjusted'),
    previews: path.join(dir, 'previews'),
  }
}

/**
 * A cache entry: the spread's hash when its sheet was rendered, and the sheet file's size and time
 * then (`sheet`), which tells a sheet saved later from the editor. Older entries are the hash alone.
 */
const entryHash = (e) => (typeof e === 'string' ? e : e && e.hash)

/** @returns {Promise<void>} */
function sipsResize(src, dst, maxSide) {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/sips',
      ['-Z', String(maxSide), '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', src, '--out', dst],
      (err, _o, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve()),
    )
  })
}

/**
 * What a spread can't carry over, said plainly in the job's report. Template overrides, text,
 * shapes and colour adjustments all reach the sheet; a vignette shows in the preview only, as it
 * did with Photoshop.
 */
function unsupportedEdits(spread, ws) {
  const out = []
  if (spread.photoIds.some((id) => ((ws.imageAdjustments || {})[id] || {}).vignette))
    out.push('a vignette shows in the preview only, not in the sheet')
  return out
}

/**
 * Start rendering. Returns at once with the job id; progress arrives as `render.progress`
 * events and the end as `render.finished`.
 * Sheets saved from the editor since they were rendered are kept, unless `overwriteEdited` (the
 * user chose those spreads knowing it replaces their edits).
 * @param {{ album: string, spreads?: number[]|null, force?: boolean, overwriteEdited?: boolean }} p
 * @param {{ emit: (event: string, data: object) => void }} ctx
 */
async function startRender(p, { emit }) {
  if (!p.album) throw new Error('missing `album`')
  const settings = printSettings(p)
  const lease = await reserveJob('render', p.album)
  try {
    let album = await migrateAlbum({ album: p.album }, { lease: lease.project })
    const projectText = await fs.promises.readFile(album.file, 'utf8')
    const data = JSON.parse(projectText)
    album = await require('./album').openAlbum({ path: album.path }, { data })
    await identifyJob(lease, album)
    const ws = data.workspace || data
    const outputFolder = ws.outputToken || path.join(album.path, 'exports')
    await fs.promises.mkdir(outputFolder, { recursive: true })
    const wanted = spreadSelection(p.spreads, album.spreads)
    const spreads = album.spreads.filter((s) => !wanted || wanted.has(s.n))
    const job = {
      id: lease.id,
      total: spreads.length,
      done: 0,
      skipped: 0,
      failed: 0,
      cancelled: false,
      startedAt: Date.now(),
      outputFolder,
      results: [],
      finishingErrors: /** @type {string[]} */ ([]),
    }
    current = job
    emit('render.started', { jobId: job.id, total: job.total, outputFolder, album: album.path })
    void (async () => {
      let error = null
      try {
        await runJob(
          job,
          { album, ws, projectText, spreads, settings, lease, force: !!p.force, overwriteEdited: !!p.overwriteEdited },
          emit,
        )
      } catch (e) {
        error = e.message
        job.failed = Math.max(1, job.failed)
      } finally {
        if (current === job) current = null
        try {
          await releaseJob(lease)
        } catch (e) {
          job.finishingErrors.push(`The render job finished, but its leases could not finish releasing: ${e.message}`)
        }
        const finishingError = job.finishingErrors.length ? job.finishingErrors.join(' ') : null
        // The durable per-sheet results remain authoritative even if shutdown or lock
        // retirement reports a problem. A finishing error is never a failed print sheet.
        emit('render.finished', {
          jobId: job.id,
          total: job.total,
          done: job.done,
          skipped: job.skipped,
          failed: job.failed,
          cancelled: job.cancelled,
          error: [error, finishingError].filter(Boolean).join(' ') || null,
          finishingError,
          warnings: [...job.finishingErrors],
          results: job.results,
          ms: Date.now() - job.startedAt,
          outputFolder,
        })
      }
    })()
    return { jobId: job.id, total: job.total, outputFolder, album: album.path }
  } catch (e) {
    try {
      await releaseJob(lease)
    } catch (release) {
      e.message += ` ${release.message}`
    }
    throw e
  }
}

function assertRenderable(s) {
  if (!s.template || !s.template.file)
    throw new Error(s.template ? `the template ${s.template.name} isn't on disk` : 'the spread has no template')
  if (!s.photoIds.length) throw new Error('the spread has no photos')
}

/** Edited by hand in the editor: never replaced without being asked. */
const editedSheet = (record, existingBefore, overwriteEdited) =>
  !!existingBefore && !overwriteEdited && (!verifiedSheetRecord(record) || record.sheetDigest !== existingBefore.digest)

async function sheetIsCurrent(run, work, existingBefore, hash) {
  return (
    !run.force &&
    !!existingBefore &&
    entryHash(work.record) === hash &&
    (await meetsPrintResolution(work.existingPath, run.settings, existingBefore.digest))
  )
}

function spreadSkipped(run, work, extra = {}) {
  run.job.skipped++
  work.report('skipped', extra)
  run.job.results.push({ n: work.s.n, state: 'skipped', ...extra })
}

/** Each photo, developed, adjusted and frozen in the spread's private stage. */
async function freezePhotos(run, work, inputValues) {
  const { album, ws, paths } = run
  const { s, privateStage, privateFiles } = work
  /** @type {Array<{ file: string, digest: string, orient: 'h' | 'v', name: string, edit: object }>} */
  const photos = []
  for (const id of s.photoIds) {
    const ph = album.photos[id]
    if (!ph || !ph.original)
      throw new Error(`The original photo ${id} is missing; thumbnails cannot be rendered for print.`)
    const src = ph.original
    const expectedSource = inputValues[2].find((v) => v[0] === id)[2]
    const developed = await placeableEvidence(src, paths.raw)
    if (developed.sourceKey !== contentKey(src, expectedSource))
      throw new Error('The original changed before its render snapshot was made.')
    const adjusted = await bakeAdjustmentsEvidence(developed.file, (ws.imageAdjustments || {})[id], paths.adjusted)
    if (adjusted.sourceKey !== contentKey(developed.file, developed.digest))
      throw new Error('The developed image changed before its adjustment snapshot was made.')
    const frozen = await privateStage.snapshot(adjusted.file, adjusted.digest)
    privateFiles.set(frozen, adjusted.digest)
    photos.push({
      file: frozen,
      digest: adjusted.digest,
      orient: ph.orient === 'v' ? 'v' : 'h',
      name: ph.base,
      edit: { rotation: (ws.imageRotations || {})[id] || 0, ...((ws.imagePlacements || {})[id] || {}) },
    })
  }
  return photos
}

async function buildStagedSheet(run, work, template, photos) {
  const { job, ws, settings } = run
  const { s, report, stagedPsd, preview } = work
  report('building')
  if (!run.pc) run.pc = new PhotoCraftSession({ writeRoot: job.outputFolder })
  return buildSheet(run.pc, {
    template,
    photos,
    layerEdits: (ws.pageLayerEdits || {})[s.n] || null,
    overlays: (ws.pageOverlays || {})[s.n] || null,
    outPsd: stagedPsd,
    outJpg: preview,
    printSettings: settings,
  })
}

/** What publication checks last: nothing changed under the sheet while it was built. */
function snapshotValidator(run, work, hash) {
  const { album, ws, projectText } = run
  const { s, privateStage, privateFiles, stagedPsd, sourceStage } = work
  return async () => {
    if ((await fs.promises.readFile(album.file, 'utf8')) !== projectText || (await spreadHash(s, album, ws)) !== hash)
      throw new Error('The project or source files changed during rendering. Retry from the current revision.')
    await privateStage.assertFiles()
    if (
      (
        await Promise.all(
          [...privateFiles]
            .filter(([file]) => file !== stagedPsd)
            .map(async ([file, expected]) => (await fileDigest(file)) === expected),
        )
      ).some((ok) => !ok)
    ) {
      throw new Error(`A private render source changed during construction. Preserve ${sourceStage} before retrying.`)
    }
  }
}

function cacheWithSheet(run, work, hash, preflight) {
  return {
    ...run.cache,
    spreads: {
      ...run.cache.spreads,
      [work.s.id]: {
        path: work.outPsd,
        outputFolder: run.job.outputFolder,
        hash,
        settings: run.settings,
        resolutionEvidence: preflight.info.filter((e) => e.code === 'effective_ppi'),
      },
    },
  }
}

const committedWithoutHistory = (error, outPsd) =>
  !!error.renderCommitted &&
  !!error.cache &&
  !!error.cacheRevision &&
  !!error.sheetRecord &&
  error.sheetRecord.path === outPsd

/** Publishes the sheet; an error after its commit counts as published, with a warning to review. */
async function publishSheet(run, work, request, committedWarnings) {
  const { job, lease, projectText } = run
  try {
    return await publishRender(
      { ...request, expectedProjectRevision: revisionOf(projectText) },
      {
        assertOwned: () => lease.project.assertOwned(),
        assertOutput: (requested) => lease.project.outputNamespace.assertFor(requested),
        isCancelled: () => job.cancelled,
        validateSnapshot: work.validateSnapshot,
      },
    )
  } catch (error) {
    if (!committedWithoutHistory(error, work.outPsd)) throw error
    committedWarnings.push(
      `The print sheet and ownership record were committed. Recovery history needs review: ${error.message}`,
    )
    return error
  }
}

/**
 * Proofs are derived. A failure after durable commit must report the saved sheet,
 * rather than claim that the render failed or that the old pair was restored.
 */
async function refreshSheetProof(run, work, inputValues, committedWarnings) {
  const { album, ws, projectText, lease, proofDir, emit } = run
  const { s, outPsd, preview, stagedProof, privateStage, privateFiles } = work
  try {
    await sipsResize(preview, stagedProof, 2400)
    const proofDigest = await fileDigest(stagedProof)
    await privateStage.register(stagedProof, { digest: proofDigest })
    privateFiles.set(stagedProof, proofDigest)
    await recordSheetProof(album, ws, s, outPsd, {
      proof: stagedProof,
      expectedHash: proofInputHash(inputValues),
      projectText,
      lease: lease.project,
    })
    privateStage.forget(stagedProof)
    emit('proofs.updated', {
      album: album.path,
      n: s.n,
      proof: path.join(proofDir, `live_page_${String(s.n).padStart(3, '0')}.jpg`),
      source: 'sheet',
    })
  } catch (error) {
    committedWarnings.push(
      `The print sheet is saved, but its preview could not be refreshed: ${error.message} Refresh previews after resolving this problem.`,
    )
  }
}

/** A spread from its checks to its result. A spread with nothing to do returns early. */
async function renderSheet(run, work) {
  const { job, album, ws, settings, lease, overwriteEdited, paths } = run
  const { s, name, record, existingPath, outPsd, report, t0, privateFiles } = work
  await lease.project.assertOwned()
  assertRenderable(s)
  const existingBefore = existingPath ? await fingerprintRenderFile(existingPath) : null
  const sheetBefore = existingPath === outPsd ? existingBefore : await fingerprintRenderFile(outPsd)
  if (sheetBefore && existingPath !== outPsd)
    throw new Error(`An unowned sheet exists at ${outPsd}. Preserve it before rendering.`)
  if (editedSheet(record, existingBefore, overwriteEdited)) return spreadSkipped(run, work, { reason: 'edited' })
  const inputValues = await spreadInputs(s, album, ws)
  const hash = renderInputHash(inputValues)
  if (await sheetIsCurrent(run, work, existingBefore, hash)) return spreadSkipped(run, work)
  report('preparing')
  const preflight = await preflightAlbum(
    album,
    ws,
    { ...settings, phase: 'render' },
    [s.n],
    new Map([[s.n, inputValues]]),
  )
  if (preflight.errors.length) throw new Error(preflight.errors.map((e) => e.message).join(' '))
  await fs.promises.mkdir(path.dirname(outPsd), { recursive: true })
  const privateStage = (work.privateStage = await createPrivateStage(paths.dir, 'render-sources-'))
  work.sourceStage = privateStage.path
  const stagedPsd = (work.stagedPsd = path.join(work.sourceStage, `${name}.${crypto.randomUUID()}.part.psd`))
  const preview = (work.preview = path.join(work.sourceStage, `${name}.${crypto.randomUUID()}.jpg`))
  work.stagedProof = `${stagedPsd}.proof.jpg`
  const template = await privateStage.snapshot(s.template.file, inputValues[1])
  privateFiles.set(template, inputValues[1])
  const warnings = unsupportedEdits(s, ws)
  const photos = await freezePhotos(run, work, inputValues)
  const built = await buildStagedSheet(run, work, template, photos)
  if (built.warnings.length)
    throw new Error(`Sheet construction left edits or photos unapplied: ${built.warnings.join('; ')}`)
  const stagedDigest = await fileDigest(stagedPsd)
  await privateStage.register(stagedPsd, { digest: stagedDigest })
  privateFiles.set(stagedPsd, stagedDigest)
  const previewDigest = await fileDigest(preview)
  await privateStage.register(preview, { digest: previewDigest })
  privateFiles.set(preview, previewDigest)
  work.validateSnapshot = snapshotValidator(run, work, hash)
  const cacheNext = cacheWithSheet(run, work, hash, preflight)
  const committedWarnings = []
  const publication = await publishSheet(
    run,
    work,
    {
      albumFile: album.file,
      outputFolder: job.outputFolder,
      spreadId: s.id,
      source: stagedPsd,
      sourceDigest: stagedDigest,
      sheetBefore,
      cacheBefore: run.cacheRevision,
      cacheNext,
    },
    committedWarnings,
  )
  run.cache = publication.cache
  run.cacheRevision = publication.cacheRevision
  await refreshSheetProof(run, work, inputValues, committedWarnings)
  job.done++
  const r = {
    n: s.n,
    state: 'done',
    committed: true,
    ms: Date.now() - t0,
    path: outPsd,
    warnings: [...warnings, ...built.warnings, ...committedWarnings],
  }
  job.results.push(r)
  report('done', { ms: r.ms, warnings: r.warnings })
}

/** Records a spread's failure; returns 'stop' when it was the job being cancelled. */
async function spreadFailed(run, work, e) {
  const { job, pc } = run
  const { s, report } = work
  if (e.code === 'RENDER_CANCELLED' && !e.recoveryRequired) {
    job.results.push({ n: s.n, state: 'cancelled', reason: 'stopped before commit' })
    report('cancelled', { reason: 'stopped before commit' })
    return 'stop'
  }
  job.failed++
  const error = e && e.message ? e.message : String(e)
  job.results.push({ n: s.n, state: 'failed', error })
  report('failed', { error })
  // A dead engine is replaced for the next sheet; a live one is cleaned up.
  if (pc && pc.proc.exitCode !== null) run.pc = null
  else if (pc) await closeAll(pc)
}

/**
 * Retire the complete capability atomically. Digest-check followed by unlink
 * cannot protect a name replaced at the final boundary on this filesystem.
 */
async function retireRenderStage(run, work) {
  if (!work.privateStage) return
  try {
    await work.privateStage.cleanup()
  } catch (error) {
    run.job.finishingErrors.push(`Private render work needs review: ${error.message}`)
  }
}

/**
 * One spread. An error from the record or path lookups ends the job, so they stay outside the `try`.
 * The `return await`s keep `finally` from retiring the stage before the helper ends.
 */
async function renderSpread(run, s, i) {
  const { job, album, ws, emit } = run
  const name = outputName(s.n)
  const record = await ownedSheetRecord(ws, album.path, s.id, run.cache)
  const existingPath = record && record.path
  const outPsd = canonicalSheetPath(job.outputFolder, s.id)
  const report = (state, extra = {}) =>
    emit('render.progress', { jobId: job.id, index: i + 1, total: job.total, n: s.n, state, ...extra })
  const work = {
    s,
    name,
    record,
    existingPath,
    outPsd,
    report,
    t0: Date.now(),
    sourceStage: null,
    privateStage: null,
    privateFiles: new Map(),
  }
  try {
    return await renderSheet(run, work)
  } catch (e) {
    return await spreadFailed(run, work, e)
  } finally {
    await retireRenderStage(run, work)
  }
}

async function closeRenderSession({ pc, job }) {
  if (!pc) return
  try {
    await pc.close()
  } catch (error) {
    job.finishingErrors.push(
      `The print-sheet processing finished, but PhotoCraft could not finish closing: ${error.message}`,
    )
  }
}

async function runJob(job, { album, ws, projectText, spreads, settings, lease, force, overwriteEdited }, emit) {
  await lease.project.assertOwned()
  const paths = cachePaths(job.outputFolder)
  const previous = await readRenderCacheSnapshot(job.outputFolder, { albumFile: album.file })
  const cacheRevision = previous.revision
  const cache = previous.data.version === 2 ? previous.data : { version: 2, spreads: {} }
  cache.albumFile = album.file
  const proofDir = path.join(album.path, 'proofs', 'pages')
  await fs.promises.mkdir(proofDir, { recursive: true })
  await fs.promises.mkdir(paths.previews, { recursive: true })
  const run = {
    job,
    album,
    ws,
    projectText,
    settings,
    lease,
    force,
    overwriteEdited,
    emit,
    paths,
    proofDir,
    pc: null,
    cache,
    cacheRevision,
  }
  try {
    for (let i = 0; i < spreads.length; i++) {
      if (job.cancelled) break
      if ((await renderSpread(run, spreads[i], i)) === 'stop') break
    }
  } finally {
    await closeRenderSession(run)
  }
  return job.results
}

/**
 * Each spread's render state without rendering anything: `current` (the sheet exists and nothing
 * changed since), `stale` (it exists but its photos, template or edits changed), `missing` (no
 * sheet yet), or `blocked` (it can't render: no template or no photos, with the reason).
 * `edited`: the sheet was saved from the editor after it was rendered (renders keep it).
 */
async function renderPlan({ album: albumPath, ...p }) {
  if (!albumPath) throw new Error('missing `album`')
  return withProjectLease(
    albumPath,
    async ({ lease }) =>
      withProjectOutputs(
        lease,
        async () => {
          const album = await migrateAlbum({ album: albumPath }, { lease })
          const settings = printSettings(p)
          const data = await readProject(album.file)
          const ws = data.workspace || data
          const outputFolder = outputOf(ws, album.path)
          await lease.outputNamespace.assertFor(outputFolder)
          const cache = await readRenderCache(outputFolder, { albumFile: album.file })
          const spreads = await Promise.all(
            album.spreads.map(async (s) => {
              if (!s.template || !s.template.file)
                return { n: s.n, state: 'blocked', reason: s.template ? 'Template not on disk' : 'No template' }
              if (!s.photoIds.length) return { n: s.n, state: 'blocked', reason: 'No photos' }
              const record = await ownedSheetRecord(ws, album.path, s.id, cache)
              const out = record && record.path
              if (!out) return { n: s.n, id: s.id, state: 'missing' }
              const before = await fingerprintRenderFile(out)
              if (!before) return { n: s.n, state: 'missing' }
              const hash = await spreadHash(s, album, ws)
              const resolutionReady = await meetsPrintResolution(out, settings, before.digest)
              const verified = verifiedSheetRecord(record)
              return {
                n: s.n,
                id: s.id,
                state: verified && entryHash(record) === hash && resolutionReady ? 'current' : 'stale',
                reason: !verified
                  ? 'This older sheet has no verified content history. Preserve manual work before explicitly rendering a replacement.'
                  : resolutionReady
                    ? undefined
                    : 'Render at the configured print resolution',
                edited: !verified || record.sheetDigest !== before.digest,
                unverified: !verified,
                unsupported: unsupportedEdits(s, ws),
              }
            }),
          )
          return { outputFolder, spreads, running: renderStatus() }
        },
        { kind: 'render-plan' },
      ),
    { kind: 'render-plan' },
  )
}

/** @param {{ jobId?: string }} [options] */
function cancelRender({ jobId } = {}) {
  if (!current || (jobId && current.id !== jobId)) return { cancelled: false }
  current.cancelled = true
  return { cancelled: true }
}

function renderStatus() {
  return current
    ? {
        running: true,
        jobId: current.id,
        total: current.total,
        done: current.done,
        skipped: current.skipped,
        failed: current.failed,
      }
    : { running: false }
}

module.exports = { startRender, cancelRender, renderStatus, renderPlan, spreadHash, unsupportedEdits }
