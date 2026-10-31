'use strict'

// Every path of a render job. Everything runJob reaches is a stub answering a clean render, and a
// row overrides what it needs. The real engine and real files are in render_finish.test.js.

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')

const { contentKey } = require('../lib/cache')
const { loadPrivate } = require('./load_private')

const ALBUM = '/album'
const PROJECT_FILE = '/album/project.json'
const OUT = '/out'
const SHEET = '/out/s1.psd'
const PROJECT = '{"project":1}'
const SETTINGS = { size: 'print', ppi: 300 }
const INPUTS = ['edition', 'template-digest', [['a', 'name', 'photo-digest']]]
const ORIGINAL = '/shoot/a.cr2'
const DEVELOPED = '/developed/a.jpg'
const ADJUSTED = '/adjusted/a.jpg'
const PROOF = '/album/proofs/pages/live_page_001.jpg'
const FROZEN_TEMPLATE = '/stage/frozen-t.psd'
const FROZEN_PHOTO = '/stage/frozen-a.jpg'
const STAGED = '/stage/sheet_1.uuid1.part.psd'
const PREVIEW = '/stage/sheet_1.uuid2.jpg'
const STAGED_PROOF = `${STAGED}.proof.jpg`
const VERIFIED = { path: SHEET, hash: 'hash', sheetDigest: 'sheet-digest', verified: true }
const SAME_SHEET = { digest: 'sheet-digest' }
const VIGNETTE = 'a vignette shows in the preview only, not in the sheet'

const spread = (n = 1, extra = {}) => ({
  n,
  id: `s${n}`,
  template: { name: 'T', file: '/templates/t.psd' },
  photoIds: ['a'],
  ...extra,
})

const fail = (message, fields) => {
  throw Object.assign(new Error(message), fields)
}

/** What a clean render hears from everything it calls. */
const CLEAN = {
  ownedSheetRecord: () => null,
  canonicalSheetPath: (folder, id) => `${folder}/${id}.psd`,
  outputName: (n) => `sheet_${n}`,
  verifiedSheetRecord: (record) => record.verified === true,
  readRenderCacheSnapshot: () => ({ revision: 'rev0', data: { version: 2, spreads: {}, kept: true } }),
  fingerprintRenderFile: () => null,
  spreadInputs: () => INPUTS,
  renderInputHash: () => 'hash',
  spreadHash: () => 'hash',
  meetsPrintResolution: () => true,
  preflightAlbum: () => ({ errors: [], info: [] }),
  placeableEvidence: () => ({ file: DEVELOPED, digest: 'developed', sourceKey: contentKey(ORIGINAL, 'photo-digest') }),
  bakeAdjustmentsEvidence: () => ({
    file: ADJUSTED,
    digest: 'adjusted',
    sourceKey: contentKey(DEVELOPED, 'developed'),
  }),
  buildSheet: () => ({ warnings: [] }),
  closeAll: () => undefined,
  fileDigest: (file) => {
    if (file.endsWith('.proof.jpg')) return 'proof'
    if (file.endsWith('.part.psd')) return 'staged'
    return { [FROZEN_TEMPLATE]: 'template-digest', [FROZEN_PHOTO]: 'adjusted' }[file] || 'preview'
  },
  readFile: () => PROJECT,
  mkdir: () => undefined,
  snapshot: (file) => (file.endsWith('.psd') ? FROZEN_TEMPLATE : FROZEN_PHOTO),
  register: () => undefined,
  forget: () => undefined,
  assertFiles: () => undefined,
  cleanup: () => undefined,
  publishRender: async (request, hooks) => {
    await hooks.assertOwned()
    await hooks.assertOutput(OUT)
    hooks.isCancelled()
    await hooks.validateSnapshot()
    return { cache: { ...request.cacheNext, published: true }, cacheRevision: `rev-${request.spreadId}` }
  },
  revisionOf: () => 'project-revision',
  sips: (args, done) => done(null, '', ''),
  recordSheetProof: () => undefined,
  proofInputHash: () => 'proof-hash',
  assertOwned: () => undefined,
  assertOutput: () => undefined,
  sessionClose: () => undefined,
}

/**
 * runJob with every collaborator stubbed. `answers` replaces entries of CLEAN and `options` replaces
 * runJob's arguments; `run()` starts the job. `calls` lists every call as [name, ...arguments].
 */
function harness(answers = {}, options = {}) {
  const table = { ...CLEAN, ...answers }
  const calls = []
  const events = []
  const sessions = []
  const stub =
    (name) =>
    (...args) => {
      calls.push([name, ...args])
      return table[name](...args)
    }
  const uuid = { n: 0 }
  class PhotoCraftSession {
    constructor(settings) {
      calls.push(['session', settings])
      this.proc = { exitCode: null }
      sessions.push(this)
    }

    close() {
      calls.push(['session.close'])
      return table.sessionClose()
    }
  }
  const { runJob } = loadPrivate('../lib/render.js', {
    names: ['runJob'],
    stubs: {
      child_process: { execFile: (_command, args, done) => table.sips(args, done) },
      crypto: { ...crypto, randomUUID: () => `uuid${++uuid.n}` },
      fs: { ...fs, promises: { ...fs.promises, mkdir: stub('mkdir'), readFile: stub('readFile') } },
      './cache': { contentKey, fileDigest: stub('fileDigest') },
      './private_stage': {
        createPrivateStage: async (...args) => {
          calls.push(['stage', ...args])
          return {
            path: '/stage',
            snapshot: stub('snapshot'),
            register: stub('register'),
            forget: stub('forget'),
            assertFiles: stub('assertFiles'),
            cleanup: stub('cleanup'),
          }
        },
      },
      './inputs': { spreadInputs: stub('spreadInputs') },
      './render_inputs': { spreadHash: stub('spreadHash'), renderInputHash: stub('renderInputHash') },
      './render_transaction': {
        publishRender: stub('publishRender'),
        fingerprintRenderFile: stub('fingerprintRenderFile'),
      },
      './project_transaction': { revisionOf: stub('revisionOf') },
      './photocraft': { PhotoCraftSession },
      './proofs': { recordSheetProof: stub('recordSheetProof'), proofInputHash: stub('proofInputHash') },
      './parity': { bakeAdjustmentsEvidence: stub('bakeAdjustmentsEvidence') },
      './raw': { placeableEvidence: stub('placeableEvidence') },
      './sheet': { buildSheet: stub('buildSheet'), closeAll: stub('closeAll'), outputName: stub('outputName') },
      './project': {},
      './sheets': {
        canonicalSheetPath: stub('canonicalSheetPath'),
        outputFolder: () => OUT,
        ownedSheetRecord: stub('ownedSheetRecord'),
        readRenderCache: () => ({}),
        readRenderCacheSnapshot: stub('readRenderCacheSnapshot'),
        verifiedSheetRecord: stub('verifiedSheetRecord'),
      },
      './jobs': {},
      './output_lock': {},
      './preflight': { preflightAlbum: stub('preflightAlbum') },
      './print_settings': { printSettings: (p) => p, meetsPrintResolution: stub('meetsPrintResolution') },
      './album': {},
    },
  }).__private
  const spreads = options.spreads || [spread()]
  const job = {
    id: 'job',
    total: spreads.length,
    done: 0,
    skipped: 0,
    failed: 0,
    cancelled: false,
    startedAt: 0,
    outputFolder: OUT,
    results: [],
    finishingErrors: [],
  }
  const lease = { project: { assertOwned: stub('assertOwned'), outputNamespace: { assertFor: stub('assertOutput') } } }
  const album = { path: ALBUM, file: PROJECT_FILE, photos: { a: { original: ORIGINAL, base: 'a', orient: 'h' } } }
  const given = {
    ws: {},
    projectText: PROJECT,
    settings: SETTINGS,
    lease,
    force: false,
    overwriteEdited: false,
    ...options,
    album: { ...album, ...options.album },
    spreads,
  }
  const named = (name) => calls.filter((call) => call[0] === name)
  return {
    runJob,
    job,
    events,
    calls,
    options: given,
    sessions,
    named,
    run: () => runJob(job, given, (event, data) => events.push([event, data])),
  }
}

/** The results of a job that ran to its end. */
async function finished(answers, options) {
  const h = harness(answers, options)
  assert.equal(await h.run(), h.job.results)
  return h
}

const failedWith = async (error, answers, options) => {
  const h = await finished(answers, options)
  assert.deepEqual(h.job.results, [{ n: 1, state: 'failed', error }])
  assert.equal(h.job.failed, 1)
  return h
}

const doneResult = (extra) => ({
  n: 1,
  state: 'done',
  committed: true,
  ms: 0,
  path: SHEET,
  warnings: [],
  ...extra,
})

test.beforeEach((t) => t.mock.method(Date, 'now', () => 5000))

// ── what can't be rendered ──────────────────────────────────────────────────

test('a spread with no template fails', async () => {
  await failedWith('the spread has no template', {}, { spreads: [spread(1, { template: null })] })
})

test('a template not on disk fails, by name', async () => {
  await failedWith("the template T isn't on disk", {}, { spreads: [spread(1, { template: { name: 'T' } })] })
})

test('a spread with no photos fails', async () => {
  await failedWith('the spread has no photos', {}, { spreads: [spread(1, { photoIds: [] })] })
})

test('a sheet owned elsewhere leaves no way past a file at the output path', async () => {
  await failedWith(`An unowned sheet exists at ${SHEET}. Preserve it before rendering.`, {
    ownedSheetRecord: () => ({ ...VERIFIED, path: '/old/s1.psd' }),
    fingerprintRenderFile: () => SAME_SHEET,
  })
})

test('a file at the output path with no record is not overwritten', async () => {
  await failedWith(`An unowned sheet exists at ${SHEET}. Preserve it before rendering.`, {
    fingerprintRenderFile: () => SAME_SHEET,
  })
})

test('a sheet owned elsewhere that is gone renders at the output path', async () => {
  const h = await finished({
    ownedSheetRecord: () => ({ ...VERIFIED, path: '/old/s1.psd' }),
    fingerprintRenderFile: (file) => (file === '/old/s1.psd' ? null : null),
  })
  assert.deepEqual(h.job.results, [doneResult()])
  assert.deepEqual(
    h.named('fingerprintRenderFile').map((c) => c[1]),
    ['/old/s1.psd', SHEET],
  )
})

test('a sheet at its own path is fingerprinted once', async () => {
  const h = await finished({ ownedSheetRecord: () => VERIFIED, fingerprintRenderFile: () => SAME_SHEET })
  assert.deepEqual(
    h.named('fingerprintRenderFile').map((c) => c[1]),
    [SHEET],
  )
})

// ── what is skipped ─────────────────────────────────────────────────────────

const OWNED = { ownedSheetRecord: () => VERIFIED, fingerprintRenderFile: () => SAME_SHEET }
const CHANGED = { renderInputHash: () => 'changed', spreadHash: () => 'changed' }

test('a sheet edited since it was rendered is kept', async () => {
  const h = await finished({ ...OWNED, fingerprintRenderFile: () => ({ digest: 'edited' }) })
  assert.deepEqual(h.job.results, [{ n: 1, state: 'skipped', reason: 'edited' }])
  assert.equal(h.job.skipped, 1)
  assert.deepEqual(h.events, [
    ['render.progress', { jobId: 'job', index: 1, total: 1, n: 1, state: 'skipped', reason: 'edited' }],
  ])
  assert.deepEqual(h.named('spreadInputs'), [])
})

test('a sheet with no verified record is kept', async () => {
  const h = await finished({ ...OWNED, verifiedSheetRecord: () => false })
  assert.deepEqual(h.job.results, [{ n: 1, state: 'skipped', reason: 'edited' }])
})

test('an edited sheet is replaced when that was asked for', async () => {
  const h = await finished(
    { ...OWNED, ...CHANGED, fingerprintRenderFile: () => ({ digest: 'edited' }) },
    { overwriteEdited: true },
  )
  assert.deepEqual(h.job.results, [doneResult()])
})

test('a current sheet is skipped with no reason', async () => {
  const h = await finished(OWNED)
  assert.deepEqual(h.job.results, [{ n: 1, state: 'skipped' }])
  assert.equal(h.job.skipped, 1)
  assert.deepEqual(h.events, [['render.progress', { jobId: 'job', index: 1, total: 1, n: 1, state: 'skipped' }]])
  assert.deepEqual(h.named('meetsPrintResolution'), [['meetsPrintResolution', SHEET, SETTINGS, 'sheet-digest']])
})

test('a current sheet renders when forced', async () => {
  const h = await finished(OWNED, { force: true })
  assert.deepEqual(h.job.results, [doneResult()])
})

test('a sheet whose inputs changed renders', async () => {
  const h = await finished({ ...OWNED, ...CHANGED })
  assert.deepEqual(h.job.results, [doneResult()])
})

test('a sheet short of the print resolution renders', async () => {
  const h = await finished({ ...OWNED, meetsPrintResolution: () => false })
  assert.deepEqual(h.job.results, [doneResult()])
})

test('an old cache entry is its hash alone', async () => {
  const h = await finished({
    ...OWNED,
    ownedSheetRecord: () => 'hash',
    verifiedSheetRecord: () => true,
    fingerprintRenderFile: () => null,
  })
  assert.deepEqual(h.job.results, [doneResult()])
})

// ── what stops a spread before it is built ──────────────────────────────────

test('preflight errors fail the spread, joined with a space', async () => {
  await failedWith('one problem. another problem.', {
    preflightAlbum: () => ({ errors: [{ message: 'one problem.' }, { message: 'another problem.' }], info: [] }),
  })
})

test('preflight runs for this spread alone, in the render phase, on these inputs', async () => {
  const h = await finished()
  const [, album, ws, settings, spreads, inputs] = h.named('preflightAlbum')[0]
  assert.equal(album, h.options.album)
  assert.equal(ws, h.options.ws)
  assert.deepEqual(settings, { ...SETTINGS, phase: 'render' })
  assert.deepEqual(spreads, [1])
  assert.deepEqual([...inputs], [[1, INPUTS]])
})

test('a photo gone from the album fails the spread', async () => {
  await failedWith(
    'The original photo a is missing; thumbnails cannot be rendered for print.',
    {},
    { album: { photos: {} } },
  )
})

test('a photo with no original fails the spread', async () => {
  await failedWith(
    'The original photo a is missing; thumbnails cannot be rendered for print.',
    {},
    { album: { photos: { a: { base: 'a', thumb: '/thumb.jpg' } } } },
  )
})

test('an original that changed before its snapshot fails the spread', async () => {
  await failedWith('The original changed before its render snapshot was made.', {
    placeableEvidence: () => ({ file: DEVELOPED, digest: 'developed', sourceKey: 'another' }),
  })
})

test('a developed image that changed before its snapshot fails the spread', async () => {
  await failedWith('The developed image changed before its adjustment snapshot was made.', {
    bakeAdjustmentsEvidence: () => ({ file: ADJUSTED, digest: 'adjusted', sourceKey: 'another' }),
  })
})

// ── what reaches the sheet ──────────────────────────────────────────────────

test('a plain photo and page reach the sheet with nothing added', async () => {
  const h = await finished()
  const [, , sheet] = h.named('buildSheet')[0]
  assert.deepEqual(sheet, {
    template: FROZEN_TEMPLATE,
    photos: [{ file: FROZEN_PHOTO, digest: 'adjusted', orient: 'h', name: 'a', edit: { rotation: 0 } }],
    layerEdits: null,
    overlays: null,
    outPsd: STAGED,
    outJpg: PREVIEW,
    printSettings: SETTINGS,
  })
})

test('a vertical photo, its turn and its placement reach the sheet', async () => {
  const h = await finished(
    {},
    {
      album: { photos: { a: { original: ORIGINAL, base: 'a', orient: 'v' } } },
      ws: { imageRotations: { a: 90 }, imagePlacements: { a: { zoom: 2 } } },
    },
  )
  const [, , sheet] = h.named('buildSheet')[0]
  assert.deepEqual(sheet.photos[0].edit, { rotation: 90, zoom: 2 })
  assert.equal(sheet.photos[0].orient, 'v')
})

test("another photo's turn and placement are not this photo's", async () => {
  const h = await finished({}, { ws: { imageRotations: { b: 90 }, imagePlacements: { b: { zoom: 2 } } } })
  assert.deepEqual(h.named('buildSheet')[0][2].photos[0].edit, { rotation: 0 })
})

test("the page's layer edits and overlays reach the sheet", async () => {
  const h = await finished({}, { ws: { pageLayerEdits: { 1: { x: {} } }, pageOverlays: { 1: ['text'] } } })
  const [, , sheet] = h.named('buildSheet')[0]
  assert.deepEqual([sheet.layerEdits, sheet.overlays], [{ x: {} }, ['text']])
})

test("another page's edits and overlays are not this page's", async () => {
  const h = await finished({}, { ws: { pageLayerEdits: { 2: { x: {} } }, pageOverlays: { 2: ['text'] } } })
  const [, , sheet] = h.named('buildSheet')[0]
  assert.deepEqual([sheet.layerEdits, sheet.overlays], [null, null])
})

test("a photo's adjustments are baked from its developed file", async () => {
  const h = await finished({}, { ws: { imageAdjustments: { a: { exposure: 1 } } } })
  assert.deepEqual(h.named('bakeAdjustmentsEvidence'), [
    ['bakeAdjustmentsEvidence', DEVELOPED, { exposure: 1 }, '/out/.album-studio/adjusted'],
  ])
  assert.deepEqual(h.named('placeableEvidence'), [['placeableEvidence', ORIGINAL, '/out/.album-studio/raw']])
})

test('two spreads share one session, rooted in the output folder', async () => {
  const h = await finished({}, { spreads: [spread(1), spread(2)] })
  assert.deepEqual(h.named('session'), [['session', { writeRoot: OUT }]])
  assert.equal(h.job.done, 2)
})

test('edits the sheet left unapplied fail the spread', async () => {
  await failedWith('Sheet construction left edits or photos unapplied: one; two', {
    buildSheet: () => ({ warnings: ['one', 'two'] }),
  })
})

// ── publishing ──────────────────────────────────────────────────────────────

test('publication hears the sheet, its stage files and what came before', async () => {
  const h = await finished({}, { ws: { outputToken: OUT } })
  const [, request, hooks] = h.named('publishRender')[0]
  assert.deepEqual(request, {
    albumFile: PROJECT_FILE,
    outputFolder: OUT,
    spreadId: 's1',
    source: STAGED,
    sourceDigest: 'staged',
    sheetBefore: null,
    cacheBefore: 'rev0',
    cacheNext: {
      version: 2,
      kept: true,
      albumFile: PROJECT_FILE,
      spreads: {
        s1: { path: SHEET, outputFolder: OUT, hash: 'hash', settings: SETTINGS, resolutionEvidence: [] },
      },
    },
    expectedProjectRevision: 'project-revision',
  })
  assert.deepEqual(Object.keys(hooks), ['assertOwned', 'assertOutput', 'isCancelled', 'validateSnapshot'])
})

test("the sheet keeps the preflight's resolution evidence and nothing else", async () => {
  const evidence = { code: 'effective_ppi', ppi: 300 }
  const h = await finished({
    preflightAlbum: () => ({ errors: [], info: [{ code: 'other' }, evidence] }),
  })
  assert.deepEqual(h.named('publishRender')[0][1].cacheNext.spreads.s1.resolutionEvidence, [evidence])
})

test('the publication hooks speak for the job', async () => {
  const seen = []
  const h = harness({
    publishRender: async (request, hooks) => {
      await hooks.assertOwned()
      await hooks.assertOutput('/asked/for')
      seen.push(hooks.isCancelled())
      h.job.cancelled = true
      seen.push(hooks.isCancelled())
      return { cache: request.cacheNext, cacheRevision: 'rev1' }
    },
  })
  await h.run()
  assert.deepEqual(seen, [false, true])
  assert.deepEqual(h.named('assertOutput'), [['assertOutput', '/asked/for']])
  assert.equal(h.named('assertOwned').length, 3)
})

test('a project changed during rendering fails at publication', async () => {
  await failedWith('The project or source files changed during rendering. Retry from the current revision.', {
    readFile: () => '{"project":2}',
  })
})

test('a spread changed during rendering fails at publication', async () => {
  await failedWith('The project or source files changed during rendering. Retry from the current revision.', {
    spreadHash: () => 'changed',
  })
})

test('a private file changed during construction fails at publication', async () => {
  await failedWith('A private render source changed during construction. Preserve /stage before retrying.', {
    fileDigest: (file) => (file === FROZEN_PHOTO ? 'tampered' : CLEAN.fileDigest(file)),
  })
})

test('a stage changed during construction fails at publication, in its own words', async () => {
  await failedWith('the stage moved', { assertFiles: () => fail('the stage moved') })
})

test('the staged sheet itself is left to the transaction to check', async () => {
  const h = harness({
    fileDigest: (file) => {
      const late = h.named('assertFiles').length > 0
      return file === STAGED && late ? 'published already' : CLEAN.fileDigest(file)
    },
  })
  await h.run()
  assert.deepEqual(h.job.results, [doneResult()])
})

const committed = (extra) => ({
  renderCommitted: true,
  cache: { version: 2, spreads: {}, saved: true },
  cacheRevision: 'rev9',
  sheetRecord: { path: SHEET },
  ...extra,
})

test('a failure after commit reports the saved sheet', async () => {
  const h = await finished(
    { publishRender: () => fail('history blocked', committed()) },
    { spreads: [spread(1), spread(2)] },
  )
  assert.deepEqual(
    h.job.results[0],
    doneResult({
      warnings: ['The print sheet and ownership record were committed. Recovery history needs review: history blocked'],
    }),
  )
  assert.equal(h.named('ownedSheetRecord')[1][4].saved, true)
  assert.equal(h.named('publishRender')[1][1].cacheBefore, 'rev9')
})

for (const [field, change] of [
  ['renderCommitted', { renderCommitted: false }],
  ['cache', { cache: null }],
  ['cacheRevision', { cacheRevision: '' }],
  ['sheetRecord', { sheetRecord: null }],
  ['sheetRecord.path', { sheetRecord: { path: '/elsewhere.psd' } }],
])
  test(`a failure with no ${field} is a failure`, async () => {
    await failedWith('history blocked', { publishRender: () => fail('history blocked', committed(change)) })
  })

// ── the proof, after the commit ─────────────────────────────────────────────

const unrefreshed = (reason) =>
  `The print sheet is saved, but its preview could not be refreshed: ${reason} Refresh previews after resolving this problem.`

const proofFailed = async (reason, answers) => {
  const h = await finished(answers, { spreads: [spread(1), spread(2)] })
  assert.deepEqual(h.job.results[0], doneResult({ warnings: [unrefreshed(reason)] }))
  assert.equal(h.named('publishRender')[1][1].cacheBefore, 'rev-s1')
  assert.equal(h.events.filter(([event]) => event === 'proofs.updated').length, 0)
}

test('sips failing leaves the sheet saved, in its own words', async () => {
  await proofFailed('sips broke', { sips: (_, done) => done(new Error('exit 1'), '', 'sips broke') })
})

test('sips failing silently leaves the sheet saved, with the exit', async () => {
  await proofFailed('exit 1', { sips: (_, done) => done(new Error('exit 1'), '', '') })
})

test('sips is asked for a 2400 pixel JPEG of the preview', async () => {
  const seen = []
  await finished({ sips: (args, done) => done(null, '', '', seen.push(args)) })
  assert.deepEqual(seen, [
    ['-Z', '2400', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', PREVIEW, '--out', STAGED_PROOF],
  ])
})

test('a proof that cannot be read leaves the sheet saved', async () => {
  await proofFailed('no proof', {
    fileDigest: (file) => (file.endsWith('.proof.jpg') ? fail('no proof') : CLEAN.fileDigest(file)),
  })
})

test('a proof the stage refuses leaves the sheet saved', async () => {
  await proofFailed('refused', {
    register: (file) => (file.endsWith('.proof.jpg') ? fail('refused') : undefined),
  })
})

test('a proof that cannot be recorded leaves the sheet saved', async () => {
  await proofFailed('no record', { recordSheetProof: () => fail('no record') })
})

test('a recorded proof is handed over and left out of the stage', async () => {
  const h = await finished()
  const [, album, ws, s, sheet, options] = h.named('recordSheetProof')[0]
  assert.deepEqual([album, ws, s, sheet], [h.options.album, h.options.ws, h.options.spreads[0], SHEET])
  assert.deepEqual(options, {
    proof: STAGED_PROOF,
    expectedHash: 'proof-hash',
    projectText: PROJECT,
    lease: h.options.lease.project,
  })
  assert.deepEqual(h.named('forget'), [['forget', STAGED_PROOF]])
})

test('a clean spread reports each step, then its proof, then done', async () => {
  const h = await finished()
  const progress = (state, extra) => ['render.progress', { jobId: 'job', index: 1, total: 1, n: 1, state, ...extra }]
  assert.deepEqual(h.events, [
    progress('preparing'),
    progress('building'),
    ['proofs.updated', { album: ALBUM, n: 1, proof: PROOF, source: 'sheet' }],
    progress('done', { ms: 0, warnings: [] }),
  ])
  assert.deepEqual(h.job.results, [doneResult()])
  assert.equal(h.job.done, 1)
})

test('a result says how long its spread took', async (t) => {
  let now = 0
  t.mock.method(Date, 'now', () => (now += 100))
  const h = await finished()
  assert.equal(h.job.results[0].ms, 100)
})

test('what a sheet cannot carry is in its result', async () => {
  const h = await finished({}, { ws: { imageAdjustments: { a: { vignette: 10 } } } })
  assert.deepEqual(h.job.results, [doneResult({ warnings: [VIGNETTE] })])
})

// ── stopping ────────────────────────────────────────────────────────────────

test('stopped during publication: cancelled, and the job stops there', async () => {
  const h = await finished(
    { publishRender: () => fail('stopped', { code: 'RENDER_CANCELLED' }) },
    { spreads: [spread(1), spread(2)] },
  )
  assert.deepEqual(h.job.results, [{ n: 1, state: 'cancelled', reason: 'stopped before commit' }])
  assert.equal(h.job.failed, 0)
  assert.deepEqual(h.events.at(-1), [
    'render.progress',
    { jobId: 'job', index: 1, total: 2, n: 1, state: 'cancelled', reason: 'stopped before commit' },
  ])
  assert.equal(h.named('ownedSheetRecord').length, 1)
  assert.equal(h.named('cleanup').length, 1)
})

test('stopped with recovery needed is a failure, and the next spread runs', async () => {
  let first = true
  const publishRender = (...args) => {
    if (!first) return CLEAN.publishRender(...args)
    first = false
    return fail('stopped, needs recovery', { code: 'RENDER_CANCELLED', recoveryRequired: true })
  }
  const h = await finished({ publishRender }, { spreads: [spread(1), spread(2)] })
  assert.deepEqual(
    h.job.results.map((r) => r.state),
    ['failed', 'done'],
  )
})

test('a job stopped between spreads goes no further', async () => {
  const h = harness(
    {
      recordSheetProof: () => {
        h.job.cancelled = true
      },
    },
    { spreads: [spread(1), spread(2)] },
  )
  await h.run()
  assert.deepEqual(
    h.job.results.map((r) => r.n),
    [1],
  )
  assert.equal(h.named('ownedSheetRecord').length, 1)
})

for (const [label, thrown, error] of [
  ['a thrown string', 'plain words', 'plain words'],
  ['a thrown zero', 0, '0'],
  ['a thrown empty string', '', ''],
])
  test(`${label} is reported as text`, async () => {
    await failedWith(error, {
      preflightAlbum: () => {
        throw thrown
      },
    })
  })

// ── after a failure ─────────────────────────────────────────────────────────

/** Spread 1 fails in `buildSheet`, after the session starts; the rest go through. */
function onceBroken(extra = {}) {
  let first = true
  return {
    buildSheet: () => {
      if (!first) return { warnings: [] }
      first = false
      return fail('the build broke', extra)
    },
  }
}

test('a failed spread does not stop the next one', async () => {
  const h = await finished(onceBroken(), { spreads: [spread(1), spread(2)] })
  assert.deepEqual(
    h.job.results.map((r) => r.state),
    ['failed', 'done'],
  )
  assert.deepEqual([h.job.failed, h.job.done], [1, 1])
})

test('a dead engine is replaced for the next spread', async () => {
  const h = harness(
    {
      buildSheet: () => {
        if (h.sessions.length > 1) return { warnings: [] }
        h.sessions[0].proc.exitCode = 1
        return fail('the engine died')
      },
    },
    { spreads: [spread(1), spread(2)] },
  )
  await h.run()
  assert.equal(h.named('session').length, 2)
  assert.deepEqual(h.named('closeAll'), [])
  assert.equal(h.named('session.close').length, 1)
})

test('a live engine is cleaned up and kept after a failure', async () => {
  const h = await finished(onceBroken(), { spreads: [spread(1), spread(2)] })
  assert.equal(h.named('session').length, 1)
  assert.deepEqual(
    h.named('closeAll').map((c) => c[1]),
    [h.sessions[0]],
  )
})

test('a failure before the engine starts has nothing to clean up', async () => {
  const h = await finished({ preflightAlbum: () => fail('not ready') })
  assert.deepEqual(h.named('closeAll'), [])
  assert.deepEqual(h.named('session.close'), [])
})

test('a failed clean-up ends the job, with the stage retired first', async () => {
  const h = harness({ ...onceBroken(), closeAll: () => fail('will not close') })
  await assert.rejects(h.run(), { message: 'will not close' })
  const order = h.calls.map((c) => c[0]).filter((name) => ['closeAll', 'cleanup', 'session.close'].includes(name))
  assert.deepEqual(order, ['closeAll', 'cleanup', 'session.close'])
})

test('a stage that will not retire goes in the finishing errors, and the result stands', async () => {
  const h = await finished({ cleanup: () => fail('still in use') })
  assert.deepEqual(h.job.results, [doneResult()])
  assert.deepEqual(h.job.finishingErrors, ['Private render work needs review: still in use'])
})

test('a stage is retired after a failure', async () => {
  const h = await finished(onceBroken())
  assert.equal(h.named('cleanup').length, 1)
})

test('with no stage made there is nothing to retire', async () => {
  const h = await finished({ preflightAlbum: () => fail('not ready') })
  assert.deepEqual(h.named('cleanup'), [])
})

// ── the job's edges ─────────────────────────────────────────────────────────

const secondFails = (run) => {
  let calls = 0
  return (...args) => (++calls === 2 ? run(...args) : CLEAN.ownedSheetRecord(...args))
}

test('a sheet-record failure ends the job and the session closes', async () => {
  const h = harness(
    { ownedSheetRecord: secondFails(() => fail('no record store')) },
    { spreads: [spread(1), spread(2)] },
  )
  await assert.rejects(h.run(), { message: 'no record store' })
  assert.deepEqual(
    h.job.results.map((r) => r.n),
    [1],
  )
  assert.equal(h.named('session.close').length, 1)
})

test('a sheet path that cannot be made ends the job', async () => {
  const h = harness({
    canonicalSheetPath: () => fail('an unsafe id'),
  })
  await assert.rejects(h.run(), { message: 'an unsafe id' })
  assert.deepEqual(h.job.results, [])
})

test('an old cache starts empty', async () => {
  const h = await finished({
    readRenderCacheSnapshot: () => ({ revision: 'rev0', data: { version: 1, spreads: { s9: {} }, kept: true } }),
  })
  assert.deepEqual(h.named('ownedSheetRecord')[0][4], { version: 2, spreads: {}, albumFile: PROJECT_FILE })
})

test('a current cache is kept, and told its album', async () => {
  const h = await finished()
  assert.deepEqual(h.named('ownedSheetRecord')[0][4].kept, true)
  assert.deepEqual(h.named('readRenderCacheSnapshot'), [['readRenderCacheSnapshot', OUT, { albumFile: PROJECT_FILE }]])
  assert.equal(h.named('ownedSheetRecord')[0][4].albumFile, PROJECT_FILE)
})

test('a job that does not hold its lease makes nothing', async () => {
  const h = harness({ assertOwned: () => fail('lease lost') })
  await assert.rejects(h.run(), { message: 'lease lost' })
  assert.deepEqual(h.named('mkdir'), [])
  assert.deepEqual(h.named('session'), [])
})

test('the job makes its proof and preview folders', async () => {
  const h = await finished({}, { spreads: [] })
  assert.deepEqual(h.named('mkdir'), [
    ['mkdir', '/album/proofs/pages', { recursive: true }],
    ['mkdir', '/out/.album-studio/previews', { recursive: true }],
  ])
})

test('a lease lost in a spread fails that spread', async () => {
  let calls = 0
  await failedWith('lease lost', { assertOwned: () => (++calls === 2 ? fail('lease lost') : undefined) })
})

test('a session that will not close goes in the finishing errors, and the results stand', async () => {
  const h = await finished({ sessionClose: () => fail('stuck') })
  assert.deepEqual(h.job.results, [doneResult()])
  assert.deepEqual(h.job.finishingErrors, [
    'The print-sheet processing finished, but PhotoCraft could not finish closing: stuck',
  ])
})

test('with everything skipped no session was started, so none closes', async () => {
  const h = await finished(OWNED)
  assert.deepEqual(h.named('session'), [])
  assert.deepEqual(h.named('session.close'), [])
})

test('each spread starts from the cache the last one published', async () => {
  const h = await finished({}, { spreads: [spread(1), spread(2)] })
  const [first, second] = h.named('publishRender')
  assert.equal(first[1].cacheBefore, 'rev0')
  assert.equal(second[1].cacheBefore, 'rev-s1')
  assert.deepEqual(Object.keys(second[1].cacheNext.spreads), ['s1', 's2'])
  assert.equal(second[1].cacheNext.published, true)
})

test("a spread's sheet folder is made before its stage", async () => {
  const h = await finished()
  const order = h.calls.map((c) => c[0])
  assert.ok(order.lastIndexOf('mkdir') < order.indexOf('stage'))
  assert.deepEqual(h.named('mkdir').at(-1), ['mkdir', OUT, { recursive: true }])
  assert.deepEqual(h.named('stage'), [['stage', '/out/.album-studio', 'render-sources-']])
})

test('stage files are frozen by the digests the inputs gave', async () => {
  const h = await finished()
  assert.deepEqual(h.named('snapshot'), [
    ['snapshot', '/templates/t.psd', 'template-digest'],
    ['snapshot', ADJUSTED, 'adjusted'],
  ])
  assert.deepEqual(h.named('register'), [
    ['register', STAGED, { digest: 'staged' }],
    ['register', PREVIEW, { digest: 'preview' }],
    ['register', STAGED_PROOF, { digest: 'proof' }],
  ])
})
