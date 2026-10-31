'use strict'

// Which route psdPixels takes for each document, and what each route's failures leave behind. The
// engine is a fake that writes a real PNG, so a failure can land at any chosen step; everything
// else, including the private stage and the colour checks, is the real code.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { tmpdir } = require('./fixtures')

const cache = tmpdir()
process.env.ALBUM_STUDIO_CACHE_DIR = cache
test.after(() => fs.rmSync(cache, { recursive: true, force: true }))

const sharp = require('../../../src/sharp_config').getSharp()
const f = require('./color_edge_fixtures')
const { loadPrivate } = require('./load_private')
const { merged, layerSection, psd, resource } = require('./psd_builder')
const realStage = require('../lib/private_stage')

const E = (detail) =>
  `The sheet composite cannot be delivered safely (${detail}). Save a real compatibility composite, or convert and save an 8-bit RGB sheet in the editor.`
const C = (detail) =>
  `The CMYK sheet cannot be delivered safely (${detail}). Save a real compatibility composite with its CMYK profile, ` +
  'or convert and save an 8-bit RGB sheet in the editor.'
const POLICY = E(
  'source file exceeds the 512 MiB source-reading policy; save a smaller compatibility sheet or template in the editor',
)
const NOT_RETAINED =
  'The editor render did not retain a verifiable colour profile. Save an 8-bit RGB sheet with its compatibility composite before delivery.'

// What the fake engine does on this run, and what it saw. Each test sets it through `route`.
let engine = null
const stages = []

async function png(file, tagged = true) {
  const image = sharp({ create: { width: 2, height: 2, channels: 3, background: '#336699' } })
  await (tagged ? image.withIccProfile('srgb') : image).png().toFile(file)
}

class FakeSession {
  constructor({ writeRoot }) {
    assert.equal(writeRoot, stages.at(-1).path)
    this.step('session')
  }
  static readPath(file) {
    return `read:${file}`
  }
  writePath(file) {
    return `write:${file}`
  }
  step(name) {
    engine.log.push(name)
    if (engine.fail === name || (engine.alsoFail && engine.alsoFail === name)) throw new Error(`${name} failed`)
  }
  async call(method, args) {
    if (method === 'doc.open') {
      engine.frozen = args.path.replace('read:', '')
      engine.bytes = fs.readFileSync(engine.frozen)
    }
    this.step(method)
    if (method === 'doc.save') await engine.write(args.path.replace('write:', ''))
  }
  async run(name, policy) {
    engine.policy = policy
    this.step(name)
  }
  async close() {
    this.step('close')
  }
}

const { psdPixels, SRGB_POLICY, MAX_PSD_SOURCE_BYTES } = loadPrivate('../lib/color.js', {
  stubs: {
    './photocraft': { PhotoCraftSession: FakeSession },
    './private_stage': {
      ...realStage,
      createPrivateStage: async (...args) => {
        const stage = await realStage.createPrivateStage(...args)
        stages.push(stage)
        if (engine.stage) engine.stage(stage)
        return stage
      },
    },
  },
})

const ENGINE = ['session', 'doc.open', 'edit.convertToProfile', 'doc.save', 'close']

function route(doc, options = {}, plan = {}) {
  stages.length = 0
  engine = { log: [], write: png, ...plan }
  return psdPixels('/unused/sheet.psd', { buffer: doc, ...options })
}
const raw8 = (...samples) => Buffer.from([0, 0, ...samples])
const raw16 = (...samples) => {
  const data = Buffer.alloc(2 + samples.length * 2)
  samples.forEach((sample, i) => data.writeUInt16BE(sample, 2 + i * 2))
  return data
}
const black = raw8(...Array(12).fill(0))
const profileResource = async (name) => resource(1039, await f.icc(name))
const greyResource = () => resource(1039, f.grayGammaProfile())
const iccOf = async (input) => (await sharp(input).metadata()).icc
const gone = (stage) => assert.equal(fs.existsSync(stage.path), false)

// A failed render keeps its stage for inspection, and the message says where after the failure itself.
async function failsKeepingStage(work, message) {
  const error = await work.then(
    () => assert.fail('the render should have failed'),
    (failure) => failure,
  )
  assert.equal(error.message, `${message} Private work was retained at ${error.retainedPath}.`)
  assert.ok(fs.existsSync(error.retainedPath))
  gone(stages[0])
  return error
}
// The same, when the stage also holds the unregistered render, so its own cleanup has something to report.
async function failsWithUnknownFile(work, message) {
  const error = await work.then(
    () => assert.fail('the render should have failed'),
    (failure) => failure,
  )
  assert.ok(
    error.message.startsWith(`${message} Private cleanup also needs review: The private stage contains an unknown`),
    error.message,
  )
  assert.ok(error.cleanupError)
  assert.ok(fs.existsSync(error.retainedPath))
  gone(stages[0])
  return error
}

async function assertEngineResult(result, doc, name) {
  assert.deepEqual(engine.log, ENGINE, name)
  assert.deepEqual(engine.policy, SRGB_POLICY, name)
  assert.ok(doc.equals(engine.bytes), name)
  assert.equal(path.basename(engine.frozen), doc.readUInt16BE(4) === 2 ? 'source.psb' : 'source.psd', name)
  assert.deepEqual(Object.keys(result), ['input', 'width', 'height', 'cleanup'], name)
  assert.equal(path.basename(result.input), 'sheet.png', name)
  assert.deepEqual([result.width, result.height], [2, 2], name)
  await result.cleanup()
  gone(stages[0])
}

// ─── routes ──────────────────────────────────────────────────────────────────

test('over the source limit is refused before anything is read', async () => {
  await assert.rejects(route({ length: MAX_PSD_SOURCE_BYTES + 1 }), { message: POLICY })
})

test('exactly the source limit passes that check', async () => {
  await assert.rejects(route({ length: MAX_PSD_SOURCE_BYTES }), { message: E('not a PSD/PSB document') })
})

test('a CMYK document needs its profile', async () => {
  await assert.rejects(route(psd({ mode: 4, channels: 4 })), { message: C('the actual source profile is absent') })
})

test('first failure wins: a CMYK document with no profile and a bad composite', async () => {
  const doc = psd({ mode: 4, channels: 4, data: Buffer.from([0, 9]) })
  await assert.rejects(route(doc), { message: C('the actual source profile is absent') })
})

test('a profile is checked before the route is chosen', async () => {
  // Only the check reads a CMYK profile's tables, so nothing after it can refuse these.
  const broken = Buffer.from(await f.icc('cmyk'))
  for (let i = 0; i < broken.readUInt32BE(128); i++) {
    const at = 132 + i * 12
    if (broken.toString('ascii', at, at + 4).startsWith('A2B')) broken.write('BAD!', broken.readUInt32BE(at + 4))
  }
  await assert.rejects(route(psd({ resources: [resource(1039, broken)] })), {
    message:
      /^The sheet colour profile is invalid or unsupported \(source transform could not be verified by LittleCMS\)/,
  })
  assert.deepEqual(engine.log, [])
})

test('a CMYK document with a profile goes to the profiled TIFF', async () => {
  const doc = psd({ mode: 4, channels: 4, resources: [await profileResource('cmyk')] })
  const result = await route(doc, { inMemory: true })
  assert.deepEqual(Object.keys(result), ['input', 'width', 'height'])
  assert.deepEqual([result.width, result.height], [2, 2])
  assert.deepEqual([(await sharp(result.input).metadata()).space, engine.log], ['cmyk', []])
})

test('a CMYK TIFF goes to a private file unless asked for memory', async () => {
  const doc = psd({ mode: 4, channels: 4, resources: [await profileResource('cmyk')] })
  const result = await route(doc)
  assert.equal(path.basename(result.input), 'composite.tif')
  assert.equal((await sharp(result.input).metadata()).space, 'cmyk')
  await result.cleanup()
  gone(stages[0])
})

test('an RGB document needs an RGB profile', async () => {
  const doc = psd({ resources: [await profileResource('cmyk')] })
  await assert.rejects(route(doc), { message: E('the RGB source profile does not match its channels') })
})

for (const [name, build] of [
  ['grey with a grey profile', async () => psd({ mode: 1, channels: 1, resources: [greyResource()] })],
  ['grey with no profile', async () => psd({ mode: 1, channels: 1 })],
  ['Lab', async () => psd({ mode: 9, channels: 3 })],
  ['RGB at 32 bits', async () => psd({ depth: 32 })],
  ['depth 1', async () => psd({ depth: 1, data: Buffer.alloc(2) })],
  ['a PSB', async () => psd({ version: 2, depth: 32 })],
  ['an undeclared composite', async () => psd({ resources: [merged(0)] })],
  ['all black, with no declaration', async () => psd({ data: black })],
  ['all black at 16 bits', async () => psd({ depth: 16, data: raw16(...Array(12).fill(0)) })],
  [
    'all black, with an alpha plane',
    async () => {
      const data = raw8(...Array(4).fill(0), ...Array(4).fill(0), ...Array(4).fill(0), ...Array(4).fill(255))
      return psd({ channels: 4, layers: layerSection(-1), data })
    },
  ],
]) {
  test(`${name} goes to the engine`, async () => {
    const doc = await build()
    await assertEngineResult(await route(doc), doc, name)
  })
}

test('a stored composite that is all black is used when it is declared real', async () => {
  const result = await route(psd({ resources: [merged(1)], data: black }))
  assert.deepEqual(Object.keys(result), ['input', 'raw', 'width', 'height'])
  assert.deepEqual(result.raw, { width: 2, height: 2, channels: 4 })
  assert.deepEqual([...result.input], [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255])
  assert.deepEqual(engine.log, [])
})

test('one non-black sample in the last pixel keeps the stored composite', async () => {
  for (const [name, data, last] of [
    ['red', raw8(0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0), [1, 0, 0]],
    ['green', raw8(0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0), [0, 1, 0]],
    ['blue', raw8(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1), [0, 0, 1]],
  ]) {
    const result = await route(psd({ data }))
    assert.deepEqual([...result.input.subarray(12, 15)], last, name)
    assert.deepEqual(engine.log, [], name)
  }
})

test('16-bit samples are read whole, so a low byte alone counts', async () => {
  const data = raw16(...Array(11).fill(0), 1)
  const result = await route(psd({ depth: 16, data }), { inMemory: true })
  assert.deepEqual(engine.log, [])
  assert.deepEqual(await iccOf(result.input), await f.icc('srgb'))
})

test('an 8-bit composite with no profile comes back as raw samples', async () => {
  const result = await route(psd({ width: 1, height: 1, data: raw8(1, 2, 3) }))
  assert.deepEqual(Object.keys(result), ['input', 'raw', 'width', 'height'])
  assert.deepEqual([...result.input], [1, 2, 3, 255])
  assert.deepEqual(result.raw, { width: 1, height: 1, channels: 4 })
})

test('a tagged composite keeps its own profile', async () => {
  for (const [name, options] of [
    ['8-bit', {}],
    ['16-bit', { depth: 16 }],
  ]) {
    const doc = psd({ resources: [await profileResource('p3')], ...options })
    const result = await route(doc, { inMemory: true })
    assert.deepEqual(Object.keys(result), ['input', 'width', 'height'], name)
    assert.deepEqual(await iccOf(result.input), await f.icc('p3'), name)
  }
})

test('a tagged composite goes to a private file unless asked for memory', async () => {
  const result = await route(psd({ resources: [await profileResource('p3')] }))
  assert.equal(path.basename(result.input), 'composite.tif')
  await result.cleanup()
  gone(stages[0])
})

test('a 16-bit composite with no profile gains the untagged profile', async () => {
  const result = await route(psd({ depth: 16 }), { inMemory: true })
  assert.deepEqual(await iccOf(result.input), await f.icc('srgb'))
})

// ─── the engine's failures ───────────────────────────────────────────────────

for (const step of ['doc.open', 'edit.convertToProfile', 'doc.save']) {
  test(`an engine failure at ${step} closes the session and retires the stage`, async () => {
    const error = await failsKeepingStage(route(psd({ data: black }), {}, { fail: step }), `${step} failed`)
    assert.equal(error.closeError, undefined)
    assert.equal(engine.log.at(-1), 'close')
  })
}

test('an engine failure and a close failure are reported together', async () => {
  const plan = { fail: 'doc.open', alsoFail: 'close' }
  const failed = 'doc.open failed PhotoCraft close also failed: close failed'
  const error = await failsKeepingStage(route(psd({ data: black }), {}, plan), failed)
  assert.equal(error.closeError.message, 'close failed')
})

test('a close failure alone is the failure', async () => {
  await failsWithUnknownFile(route(psd({ data: black }), {}, { fail: 'close' }), 'close failed')
})

test('a stage that cannot reserve the bytes never starts the engine', async () => {
  const stage = (s) => {
    s.reserveBytes = async () => {
      throw new Error('no room')
    }
  }
  await assert.rejects(route(psd({ data: black }), {}, { stage }), { message: 'no room' })
  assert.deepEqual(engine.log, [])
  gone(stages[0])
})

test('a failed session start has nothing to close', async () => {
  await failsKeepingStage(route(psd({ data: black }), {}, { fail: 'session' }), 'session failed')
  assert.deepEqual(engine.log, ['session'])
})

test('the frozen bytes are reserved with room for the output', async () => {
  const reserved = []
  const stage = (s) => {
    const reserve = s.reserveBytes
    s.reserveBytes = async (bytes) => {
      reserved.push(bytes)
      return reserve.call(s, bytes)
    }
  }
  const doc = psd({ data: black })
  const result = await route(doc, {}, { stage })
  assert.equal(reserved[0], doc.length + 2 * 2 * 4)
  await result.cleanup()
})

test('a render that lost the source profile is refused', async () => {
  const doc = psd({ mode: 1, channels: 1, resources: [greyResource()] })
  await failsKeepingStage(route(doc, {}, { write: (file) => png(file, false) }), NOT_RETAINED)
})

test('a render with no profile is fine when the source had none', async () => {
  const doc = psd({ mode: 1, channels: 1 })
  await assertEngineResult(await route(doc, {}, { write: (file) => png(file, false) }), doc, 'untagged')
})

test('a render with a profile that fails its own check is refused', async () => {
  const bad = Buffer.from(f.adobeCompatibleProfile())
  bad[8] = 3
  const write = (file) => fs.promises.writeFile(file, f.taggedPng(f.rgbPixels(), 4, 8, bad))
  await assert.rejects(route(psd({ mode: 1, channels: 1 }), {}, { write }), /unsupported ICC version/)
  gone(stages[0])
})

test('a render that never reached the disk is a failure', async () => {
  const render = route(psd({ data: black }), {}, { write: async () => {} })
  await assert.rejects(render, { message: /^A generated private file is aliased or not independently owned\./ })
  gone(stages[0])
})

test('a stage whose files changed fails the render', async () => {
  const stage = (s) => {
    s.assertFiles = async () => {
      throw new Error('the frozen source changed')
    }
  }
  await failsWithUnknownFile(route(psd({ data: black }), {}, { stage }), 'the frozen source changed')
})
