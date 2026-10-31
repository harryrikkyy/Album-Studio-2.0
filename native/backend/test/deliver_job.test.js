'use strict'

// Every path of an export job. Everything runExport reaches is a stub answering a clean export, and
// a row overrides what it needs. Exporting a sheet for real is in deliver.test.js.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const { loadPrivate } = require('./load_private')

const SHEETS = '/out'
const STAGE = '/out/.album-studio/delivery-1'
const PROJECT = '{"project":1}'
const PATHS = {
  sheets: SHEETS,
  high: '/JPEG-High-Res',
  low: '/JPEG-Low-Res',
  pdf: '/Album - Low Res.pdf',
  cache: '/out/.album-studio/export-cache.json',
}
const SIZE = { width: 10, height: 20 }
const STAMP = (id) => ({ size: 1, mtimeMs: id })

const sheet = (n, extra = {}) => ({
  n,
  id: `s${n}`,
  psd: `/out/s${n}.psd`,
  key: `key${n}`,
  hash: `hash${n}`,
  state: 'stale',
  sheetDigest: `sheet${n}`,
  high: `/JPEG-High-Res/Page_00${n}.jpg`,
  low: `/JPEG-Low-Res/Page_00${n}.jpg`,
  ...extra,
})

const fail = (message, fields) => {
  throw Object.assign(new Error(message), fields)
}

/** What a clean export hears from everything it calls. */
const CLEAN = {
  mkdir: () => undefined,
  readFile: () => PROJECT,
  stat: () => ({ size: 321 }),
  lstat: () => ({}),
  register: () => undefined,
  transfer: () => undefined,
  assertFiles: () => undefined,
  cleanup: () => ({}),
  stage: () => undefined,
  exportSheet: () => SIZE,
  writeJpegPdf: () => undefined,
  spreadHash: (model) => model.hash,
  fileDigest: (file) => `sheet${/s(\d)\.psd$/.exec(file)[1]}`,
  verifyOwnedArtifact: () => true,
  publishDelivery: async (files, cache, stage, hooks) => {
    await hooks.validateSnapshot()
    await hooks.makeCache()
    hooks.isCancelled()
  },
  releaseJob: () => undefined,
  assertOwned: () => undefined,
}

/**
 * runExport with every collaborator stubbed. `answers` replaces entries of CLEAN and `options`
 * replaces what the job was prepared with; `run()` starts the export. `calls` lists every call as
 * [name, ...arguments]. The last `export.finished` is `finished`.
 */
function harness(answers = {}, options = {}) {
  const table = { ...CLEAN, ...answers }
  const calls = []
  const events = []
  const stub =
    (name) =>
    (...args) => {
      calls.push([name, ...args])
      return table[name](...args)
    }
  const asyncStub =
    (name) =>
    async (...args) =>
      stub(name)(...args)
  const stage = {
    path: STAGE,
    register: stub('register'),
    transfer: stub('transfer'),
    assertFiles: stub('assertFiles'),
    cleanup: stub('cleanup'),
  }
  const { runExport } = loadPrivate('../lib/deliver.js', {
    names: ['runExport'],
    stubs: {
      fs: {
        ...fs,
        promises: {
          ...fs.promises,
          mkdir: asyncStub('mkdir'),
          readFile: asyncStub('readFile'),
          stat: asyncStub('stat'),
          lstat: asyncStub('lstat'),
        },
      },
      './cache': { fileStamp: () => null, fileDigest: stub('fileDigest'), readVerifiedBuffer: () => null },
      './private_stage': {
        createPrivateStage: async (...args) => {
          calls.push(['createPrivateStage', ...args])
          await table.stage()
          return stage
        },
        withPrivateStage: async (...args) => {
          calls.push(['exportSheet', ...args])
          return table.exportSheet(...args)
        },
      },
      './pdf': { writeJpegPdf: stub('writeJpegPdf') },
      './sheet': { outputName: (n) => `Page_00${n}` },
      './render_inputs': { spreadHash: stub('spreadHash'), renderInputHash: () => 'input-hash' },
      './delivery_transaction': {
        publishDelivery: stub('publishDelivery'),
        recoverDeliveries: () => null,
        verifyOwnedArtifact: stub('verifyOwnedArtifact'),
      },
      './jobs': {
        reserveJob: () => null,
        identifyJob: () => null,
        releaseJob: stub('releaseJob'),
        spreadSelection: () => null,
      },
    },
  }).__private
  const spreads = options.spreads || [sheet(1), sheet(2)]
  const planned = (options.plan || { spreads }).spreads
  const job = {
    id: 'job',
    total: spreads.length,
    done: 0,
    skipped: 0,
    failed: 0,
    cancelled: false,
    startedAt: 5000,
    finishingErrors: [],
  }
  const lease = { project: { assertOwned: stub('assertOwned') } }
  const prepared = {
    p: {},
    plan: { spreads },
    cache: { spreads: {} },
    want: {},
    s: { highQuality: 97, lowQuality: 25, ppi: 300 },
    paths: PATHS,
    missingSheets: [],
    lease,
    album: { file: '/album/project.json', spreads: planned },
    ws: { printSpec: 'spec' },
    projectText: PROJECT,
    ...options,
    spreads,
  }
  const named = (name) => calls.filter((call) => call[0] === name)
  const progress = () => events.filter(([event]) => event === 'export.progress').map(([, data]) => data)
  return {
    job,
    events,
    calls,
    named,
    prepared,
    progress,
    run: async () => {
      await runExport(job, prepared, (event, data) => events.push([event, data]))
      return events.at(-1)[1]
    },
  }
}

const running = async (answers, options) => {
  const h = harness(answers, options)
  const finished = await h.run()
  return { ...h, finished }
}

test.beforeEach((t) => t.mock.method(Date, 'now', () => 5000))

const prepared = (n, extra) => ({ n, state: 'done', ms: 0, ...SIZE, ...extra })
const owned = (id) => ({ path: `/owned/${id}.jpg`, stamp: STAMP(id), digest: `digest${id}` })
const entry = (extra) => ({ high: owned(1), low: owned(2), ...extra })

// ── a clean export ──────────────────────────────────────────────────────────

test('two sheets export and publish', async () => {
  const { finished, progress, named, job } = await running()
  assert.deepEqual(progress(), [
    { jobId: 'job', index: 1, total: 2, n: 1, state: 'exporting' },
    { jobId: 'job', index: 2, total: 2, n: 2, state: 'exporting' },
    { jobId: 'job', total: 2, n: 1, ...prepared(1) },
    { jobId: 'job', total: 2, n: 2, ...prepared(2) },
  ])
  assert.deepEqual(finished, {
    jobId: 'job',
    total: 2,
    done: 2,
    skipped: 0,
    failed: 0,
    cancelled: false,
    ms: 0,
    paths: PATHS,
    results: [prepared(1), prepared(2)],
    pdf: null,
    missingSheets: [],
    error: null,
    finishingError: null,
    warnings: [],
  })
  assert.equal(job.done, 2)
  assert.deepEqual(named('publishDelivery')[0][1], [
    { source: `${STAGE}/Page_001-high.jpg`, target: '/JPEG-High-Res/Page_001.jpg' },
    { source: `${STAGE}/Page_001-low.jpg`, target: '/JPEG-Low-Res/Page_001.jpg' },
    { source: `${STAGE}/Page_002-high.jpg`, target: '/JPEG-High-Res/Page_002.jpg' },
    { source: `${STAGE}/Page_002-low.jpg`, target: '/JPEG-Low-Res/Page_002.jpg' },
  ])
})

test('the job works in a private stage it hands to the transaction', async () => {
  const { named, calls } = await running()
  assert.deepEqual(named('mkdir'), [['mkdir', '/out/.album-studio', { recursive: true }]])
  assert.deepEqual(named('createPrivateStage'), [['createPrivateStage', '/out/.album-studio', 'delivery-']])
  const order = calls.map((c) => c[0])
  assert.ok(order.indexOf('transfer') < order.indexOf('publishDelivery'))
  assert.equal(named('publishDelivery')[0][3], STAGE)
  assert.deepEqual(named('cleanup'), [])
})

test('each exported file joins the stage', async () => {
  const { named } = await running({}, { spreads: [sheet(1)] })
  assert.deepEqual(
    named('register').map((c) => c[1]),
    [`${STAGE}/Page_001-high.jpg`, `${STAGE}/Page_001-low.jpg`],
  )
})

test('the sheet stage sits beside the delivery stage', async () => {
  const { named } = await running({}, { spreads: [sheet(1)] })
  assert.deepEqual(named('exportSheet')[0].slice(1, 3), ['/out/.album-studio', '.delivery-sources-'])
})

// ── what is exported ────────────────────────────────────────────────────────

const READY = sheet(1, { state: 'ready' })
const READY_CACHE = { spreads: { s1: entry() } }

test('a ready sheet is skipped', async () => {
  const { finished, progress, named } = await running({}, { spreads: [READY], cache: READY_CACHE })
  assert.deepEqual(finished.results, [{ n: 1, state: 'skipped' }])
  assert.equal(finished.skipped, 1)
  assert.deepEqual(progress(), [{ jobId: 'job', index: 1, total: 1, n: 1, state: 'skipped' }])
  assert.deepEqual(named('exportSheet'), [])
})

test('a ready sheet exports when forced', async () => {
  const { finished } = await running({}, { spreads: [READY], cache: READY_CACHE, p: { force: true } })
  assert.deepEqual(finished.results, [prepared(1)])
  assert.equal(finished.skipped, 0)
})

test('a job stopped before a sheet goes no further', async () => {
  const h = harness({}, { want: { pdf: true } })
  h.job.cancelled = true
  const finished = await h.run()
  assert.equal(finished.cancelled, true)
  assert.deepEqual(finished.results, [])
  assert.deepEqual(h.named('exportSheet'), [])
  assert.deepEqual(h.named('writeJpegPdf'), [])
  assert.deepEqual(h.named('publishDelivery'), [])
})

test('a job stopped at its last sheet publishes nothing and cleans up', async () => {
  const h = harness({
    exportSheet: () => {
      h.job.cancelled = true
      return SIZE
    },
  })
  const finished = await h.run()
  assert.equal(finished.cancelled, true)
  assert.deepEqual(h.named('publishDelivery'), [])
  assert.equal(h.named('cleanup').length, 1)
  assert.equal(h.named('exportSheet').length, 1)
  assert.deepEqual(h.named('releaseJob').length, 1)
})

test('a failed sheet ends the export', async () => {
  const { finished, progress, named } = await running({ exportSheet: () => fail('no pixels') })
  assert.equal(finished.failed, 1)
  assert.equal(finished.error, 'no pixels')
  assert.equal(named('exportSheet').length, 1)
  assert.equal(named('cleanup').length, 1)
  assert.deepEqual(progress().at(-1), { jobId: 'job', total: 2, n: null, state: 'failed', error: 'no pixels' })
})

// ── the review PDF ──────────────────────────────────────────────────────────

test('a wanted PDF gathers every page, in plan order', async () => {
  const ready = sheet(2, { state: 'ready' })
  const { finished, progress, named } = await running(
    {},
    {
      plan: { spreads: [sheet(1), ready] },
      spreads: [sheet(1)],
      want: { pdf: true },
      cache: { spreads: { s2: entry() } },
    },
  )
  assert.deepEqual(progress()[1], { jobId: 'job', index: 1, total: 1, n: null, state: 'pdf', pages: 2 })
  assert.deepEqual(named('writeJpegPdf'), [
    [
      'writeJpegPdf',
      `${STAGE}/review.pdf`,
      [
        { path: `${STAGE}/Page_001-low.jpg`, ppi: 300 },
        { path: ready.low, ppi: 300 },
      ],
      { title: 'Album - Low Res' },
    ],
  ])
  assert.deepEqual(finished.pdf, { path: PATHS.pdf, pages: 2, bytes: 321 })
  assert.deepEqual(named('publishDelivery')[0][1].at(-1), { source: `${STAGE}/review.pdf`, target: PATHS.pdf })
  assert.equal(named('register').at(-1)[1], `${STAGE}/review.pdf`)
})

test('a PDF with a page missing fails', async () => {
  const { finished, named } = await running(
    {},
    { plan: { spreads: [sheet(1), sheet(2)] }, spreads: [sheet(1)], want: { pdf: true } },
  )
  const error = 'The review JPEGs are incomplete. Export the whole album first.'
  assert.equal(finished.error, error)
  assert.deepEqual(finished.pdf, { error })
  assert.deepEqual(named('writeJpegPdf'), [])
})

test('with no PDF wanted a failure leaves pdf null', async () => {
  const { finished } = await running({ exportSheet: () => fail('no pixels') })
  assert.equal(finished.pdf, null)
})

test('a PDF that cannot be written reports why', async () => {
  const { finished } = await running({ writeJpegPdf: () => fail('no room') }, { want: { pdf: true } })
  assert.deepEqual(finished.pdf, { error: 'no room' })
  assert.equal(finished.failed, 1)
})

test('with a PDF the whole plan must stand', async () => {
  const { named } = await running(
    {},
    {
      plan: { spreads: [sheet(1), sheet(2, { state: 'ready' })] },
      spreads: [sheet(1)],
      want: { pdf: true },
      cache: { spreads: { s2: entry() } },
    },
  )
  assert.deepEqual([...new Set(named('fileDigest').map((c) => c[1]))], ['/out/s1.psd', '/out/s2.psd'])
})

test('with no PDF only the chosen sheets must stand', async () => {
  const { named } = await running({}, { plan: { spreads: [sheet(1), sheet(2)] }, spreads: [sheet(1)] })
  assert.deepEqual([...new Set(named('fileDigest').map((c) => c[1]))], ['/out/s1.psd'])
})

// ── before publishing ───────────────────────────────────────────────────────

test('a project changed during the export fails it', async () => {
  const { finished, named } = await running({ readFile: () => '{"project":2}' })
  assert.equal(finished.error, 'The album changed during export. Export again from the current revision.')
  assert.deepEqual(named('publishDelivery'), [])
})

const STALE = 'Spread 1 or its source files changed during export. Render or export again.'

test('a spread gone from the album fails the export', async () => {
  const { finished } = await running({}, { album: { file: '/album/project.json', spreads: [] } })
  assert.equal(finished.error, STALE)
})

test('a spread changed during the export fails it', async () => {
  const { finished } = await running({ spreadHash: () => 'changed' })
  assert.equal(finished.error, STALE)
})

test('a sheet rewritten during the export fails it', async () => {
  const { finished } = await running({ fileDigest: () => 'changed' })
  assert.equal(finished.error, STALE)
})

test("a ready sheet's high JPEG changing fails the export", async () => {
  const { finished, named } = await running(
    { verifyOwnedArtifact: (file) => file !== '/owned/1.jpg' },
    { spreads: [READY], cache: READY_CACHE },
  )
  assert.equal(finished.error, "Spread 1's JPEGs changed during export.")
  assert.deepEqual(named('verifyOwnedArtifact')[0], ['verifyOwnedArtifact', '/owned/1.jpg', STAMP(1), 'digest1'])
})

test("a ready sheet's low JPEG changing fails the export", async () => {
  const { finished, named } = await running(
    { verifyOwnedArtifact: (file) => file !== '/owned/2.jpg' },
    { spreads: [READY], cache: READY_CACHE },
  )
  assert.equal(finished.error, "Spread 1's JPEGs changed during export.")
  assert.deepEqual(named('verifyOwnedArtifact')[1], ['verifyOwnedArtifact', '/owned/2.jpg', STAMP(2), 'digest2'])
})

test('only ready sheets are checked for that', async () => {
  const { named } = await running()
  assert.deepEqual(named('verifyOwnedArtifact'), [])
})

// ── the cache to publish ────────────────────────────────────────────────────

/** The cache handed back by makeCache. */
async function nextCache(options, answers = {}) {
  let next
  const h = harness(
    {
      publishDelivery: async (files, cache, stage, hooks) => {
        next = await hooks.makeCache()
      },
      ...answers,
    },
    options,
  )
  await h.run()
  return next
}

test('a generated sheet is recorded in full', async () => {
  const next = await nextCache({ spreads: [sheet(1)] })
  assert.deepEqual(Object.keys(next.spreads), ['s1'])
  const { at, ...record } = next.spreads.s1
  assert.equal(typeof at, 'string')
  assert.deepEqual(record, {
    n: 1,
    key: 'key1',
    hash: 'hash1',
    psd: '/out/s1.psd',
    ...SIZE,
    high: { path: sheet(1).high },
    low: { path: sheet(1).low },
  })
})

test('a stale entry whose high file is being rewritten goes', async () => {
  const stale = { n: 9, high: { path: sheet(1).high, stamp: 1 } }
  const next = await nextCache({ spreads: [sheet(1)], cache: { spreads: { old: stale } } })
  assert.deepEqual(Object.keys(next.spreads), ['s1'])
})

test('a stale entry whose low file is being rewritten goes', async () => {
  const stale = { n: 9, low: { path: sheet(1).low, stamp: 1 } }
  const next = await nextCache({ spreads: [sheet(1)], cache: { spreads: { old: stale } } })
  assert.deepEqual(Object.keys(next.spreads), ['s1'])
})

test('a stale entry with its files elsewhere stays', async () => {
  const stale = { n: 9, high: { path: '/kept.jpg', stamp: 1 }, low: { path: '/kept-low.jpg', stamp: 1 } }
  const next = await nextCache({ spreads: [sheet(1)], cache: { spreads: { old: stale } } })
  assert.deepEqual(Object.keys(next.spreads).sort(), ['old', 's1'])
})

test('a stale entry with no files stays', async () => {
  const next = await nextCache({ spreads: [sheet(1)], cache: { spreads: { old: { n: 9 } } } })
  assert.deepEqual(next.spreads.old, { n: 9 })
})

test('an entry replacing a file of its own spread stays', async () => {
  const stale = { n: 1, high: { path: sheet(1).high, stamp: 1 } }
  const next = await nextCache({ spreads: [sheet(1)], cache: { spreads: { s1: stale } } })
  assert.equal(next.spreads.s1.key, 'key1')
})

test('owned files gather the old list and every old entry', async () => {
  const cache = {
    ownedFiles: { '/earlier.jpg': 'stamp' },
    spreads: {
      a: { high: { path: '/a-high.jpg', stamp: 'h' } },
      b: { low: { path: '/b-low.jpg', stamp: 'l' } },
      c: {},
    },
  }
  const next = await nextCache({ spreads: [sheet(1)], cache })
  assert.deepEqual(next.ownedFiles, { '/earlier.jpg': 'stamp', '/a-high.jpg': 'h', '/b-low.jpg': 'l' })
})

test('with no owned list it starts from the entries', async () => {
  const next = await nextCache({ spreads: [sheet(1)] })
  assert.deepEqual(next.ownedFiles, {})
})

test('a PDF joins the cache', async () => {
  const next = await nextCache({ want: { pdf: true } })
  assert.deepEqual(next.pdf, { path: PATHS.pdf })
})

test('no PDF leaves the cache without one', async () => {
  const next = await nextCache({})
  assert.equal('pdf' in next, false)
})

test('the published cache starts from a copy', async () => {
  const cache = { spreads: { old: { n: 9 } } }
  await nextCache({ spreads: [sheet(1)], cache })
  assert.deepEqual(cache, { spreads: { old: { n: 9 } } })
})

// ── publication ─────────────────────────────────────────────────────────────

test('each publication hook checks the lease, then the snapshot, then the stage', async () => {
  for (const hook of ['validateSnapshot', 'makeCache']) {
    const h = harness({
      publishDelivery: async (files, cache, stage, hooks) => {
        h.calls.length = 0
        await hooks[hook]()
      },
    })
    await h.run()
    const order = h.calls.map((c) => c[0]).filter((name) => ['assertOwned', 'readFile', 'assertFiles'].includes(name))
    assert.deepEqual(order, ['assertOwned', 'readFile', 'assertFiles'])
  }
})

test('the transaction hears the paths and whether the job was stopped', async () => {
  const seen = []
  const h = harness({
    publishDelivery: async (files, cache, stage, hooks) => {
      seen.push(hooks.paths, hooks.isCancelled())
      h.job.cancelled = true
      seen.push(hooks.isCancelled())
      h.job.cancelled = false
    },
  })
  await h.run()
  assert.deepEqual(seen, [PATHS, false, true])
})

test('a stop asked for after the commit is too late', async () => {
  const h = harness({
    publishDelivery: async () => {
      h.job.cancelled = true
    },
  })
  const finished = await h.run()
  assert.equal(finished.cancelled, false)
  assert.equal(finished.done, 2)
})

test('a failure after the transfer points at the work and leaves it', async () => {
  const { finished, named } = await running({ publishDelivery: () => fail('journal full') })
  const error = `journal full Inspect prepared delivery work at ${STAGE} and any reported recovery history before retrying; the caller did not remove it.`
  assert.equal(finished.error, error)
  assert.equal(finished.failed, 1)
  assert.deepEqual(named('cleanup'), [])
  assert.deepEqual(named('lstat'), [['lstat', STAGE]])
})

test('a failure before the transfer says nothing of it, and cleans up', async () => {
  const { finished, named } = await running({ transfer: () => fail('not transferred') })
  assert.equal(finished.error, 'not transferred')
  assert.equal(named('cleanup').length, 1)
  assert.deepEqual(named('lstat'), [])
})

test('a stage that cannot be looked at still gets the pointer', async () => {
  const { finished } = await running({ publishDelivery: () => fail('journal full'), lstat: () => fail('gone') })
  assert.match(finished.error, /^journal full Inspect prepared delivery work at /)
})

test('stopped during publication: cancelled, not failed', async () => {
  const { finished, progress } = await running({
    publishDelivery: () => fail('stopped', { code: 'DELIVERY_CANCELLED' }),
  })
  assert.equal(finished.cancelled, true)
  assert.equal(finished.failed, 0)
  assert.equal(finished.error, null)
  assert.equal(progress().filter((p) => p.state === 'failed').length, 0)
})

for (const field of ['recoveryStage', 'recoveryJournal', 'recoveryLock', 'snapshotPath', 'retainedPath'])
  test(`stopped with ${field} left behind is a failure`, async () => {
    const { finished } = await running({
      publishDelivery: () => fail('stopped', { code: 'DELIVERY_CANCELLED', [field]: '/left/behind' }),
    })
    assert.equal(finished.cancelled, false)
    assert.equal(finished.failed, 1)
  })

test('a committed delivery with a recovery failure reports both', async () => {
  const h = harness({
    publishDelivery: () => {
      h.job.cancelled = true
      return fail('history blocked', { deliveryCommitted: true })
    },
  })
  const finished = await h.run()
  const error = `history blocked Inspect prepared delivery work at ${STAGE} and any reported recovery history before retrying; the caller did not remove it.`
  assert.equal(finished.cancelled, false)
  assert.equal(finished.done, 2)
  assert.equal(finished.failed, 0)
  assert.deepEqual(finished.warnings, [error])
  assert.equal(finished.finishingError, error)
  assert.equal(finished.error, `${error} ${error}`)
  assert.deepEqual(finished.results, [prepared(1), prepared(2)])
  assert.deepEqual(h.progress().slice(-3), [
    { jobId: 'job', total: 2, n: 1, ...prepared(1) },
    { jobId: 'job', total: 2, n: 2, ...prepared(2) },
    { jobId: 'job', total: 2, n: null, state: 'warning', error },
  ])
})

test('a committed delivery with nothing prepared has nothing to mark done', async () => {
  const { finished, progress } = await running(
    { publishDelivery: () => fail('history blocked', { deliveryCommitted: true }) },
    { spreads: [READY], cache: READY_CACHE },
  )
  assert.equal(finished.done, 0)
  assert.equal(progress().filter((p) => p.state === 'done').length, 0)
})

test('an error with no message is reported as text', async () => {
  const { finished } = await running({ exportSheet: () => fail('') })
  assert.equal(finished.error, 'Error')
})

// ── the stage, and the end of the job ───────────────────────────────────────

test('no stage made: failed, and nothing to clean up', async () => {
  const { finished, named } = await running({ stage: () => fail('no stage') })
  assert.equal(finished.error, 'no stage')
  assert.deepEqual(named('cleanup'), [])
})

test('no folder for the stage: failed, and nothing to clean up', async () => {
  const { finished, named } = await running({ mkdir: () => fail('read only') })
  assert.equal(finished.error, 'read only')
  assert.deepEqual(named('cleanup'), [])
})

test('work retained at clean-up is reported', async () => {
  const { finished } = await running({
    exportSheet: () => fail('no pixels'),
    cleanup: () => ({ retainedPath: '/history/1' }),
  })
  assert.deepEqual(finished.warnings, ['Prepared delivery work was retained at /history/1.'])
})

test('a clean-up retaining nothing reports nothing', async () => {
  const { finished } = await running({ exportSheet: () => fail('no pixels') })
  assert.deepEqual(finished.warnings, [])
})

test('a clean-up that throws is reported in its own words', async () => {
  const { finished } = await running({ exportSheet: () => fail('no pixels'), cleanup: () => fail('still in use') })
  assert.deepEqual(finished.warnings, ['still in use'])
})

test('a lease that will not release is reported, and the work stands', async () => {
  const { finished } = await running({ releaseJob: () => fail('lock stuck') })
  assert.deepEqual(finished.warnings, [
    'Delivery completed its file work, but its lease could not finish releasing: lock stuck',
  ])
  assert.equal(finished.done, 2)
})

test('an error and a finishing error go out together', async () => {
  const { finished } = await running({ exportSheet: () => fail('no pixels'), cleanup: () => fail('still in use') })
  assert.equal(finished.error, 'no pixels still in use')
  assert.equal(finished.finishingError, 'still in use')
})
