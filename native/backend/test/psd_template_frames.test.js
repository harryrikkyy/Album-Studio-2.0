'use strict'

// Which layers a template turns into photo frames, the shape each frame cuts out of its photo, and
// when the template's art comes from the cache or is made again.

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const ag = require('ag-psd')
const { tmpdir } = require('./fixtures')

const cacheDir = tmpdir()
process.env.ALBUM_STUDIO_CACHE_DIR = cacheDir
test.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }))

const sharp = require('../../../src/sharp_config').getSharp()
const cache = require('../lib/cache')
const color = require('../lib/color')
const f = require('./color_edge_fixtures')
const { loadPrivate } = require('./load_private')
const { psd } = require('./psd_builder')
const { collectFrames } = require('../lib/psd_template')

const { shapeAlpha } = loadPrivate('../lib/psd_template.js', { names: ['shapeAlpha'] }).__private

// ─── collectFrames ───────────────────────────────────────────────────────────

const FRAME = 'toolkithframe1'
const BOX = { left: 1, top: 2, right: 4, bottom: 6 }
const AREA = { x: 1, y: 2, w: 3, h: 4 }

for (const [name, node, expected] of [
  ['a layer with no bounds', { name: FRAME }, null],
  ['no right edge', { name: FRAME, left: 0, top: 0, bottom: 5 }, null],
  ['no bottom edge', { name: FRAME, left: 0, top: 0, right: 5 }, null],
  ['no width and no mask', { name: FRAME, left: 5, top: 0, right: 5, bottom: 5 }, null],
  ['no height and no mask', { name: FRAME, left: 0, top: 5, right: 5, bottom: 5 }, null],
  ['bounds alone', { name: FRAME, ...BOX }, AREA],
  ['bounds with no left or top', { name: FRAME, right: 3, bottom: 4 }, { x: 0, y: 0, w: 3, h: 4 }],
  ['bounds over a mask', { name: FRAME, ...BOX, mask: { left: 9, top: 9, right: 12, bottom: 12 } }, AREA],
  ['no width, so the mask', { name: FRAME, left: 5, top: 5, right: 5, bottom: 9, mask: BOX }, AREA],
  ['no height, so the mask', { name: FRAME, left: 5, top: 5, right: 9, bottom: 5, mask: BOX }, AREA],
  ['a mask with no left or top', { name: FRAME, mask: { right: 3, bottom: 4 } }, { x: 0, y: 0, w: 3, h: 4 }],
  ['a mask with no right edge', { name: FRAME, mask: { left: 1, top: 2, bottom: 6 } }, null],
  ['a mask with no bottom edge', { name: FRAME, mask: { left: 1, top: 2, right: 4 } }, null],
  ['an empty mask', { name: FRAME, mask: {} }, null],
]) {
  test(`collectFrames reads ${name}`, () => {
    const frames = collectFrames([node])
    assert.equal(frames.length, expected ? 1 : 0)
    if (expected) {
      const { x, y, w, h } = frames[0]
      assert.deepEqual({ x, y, w, h }, expected)
    }
  })
}

test('a frame keeps exactly its fields, with its layer out of sight', () => {
  const node = { name: 'ToolkitVFrame_002', ...BOX }
  const [frame] = collectFrames([node])
  assert.deepEqual(Object.keys(frame), [
    'name',
    'orient',
    'x',
    'y',
    'w',
    'h',
    'z',
    'opacity',
    'hidden',
    'stroke',
    'mask',
  ])
  assert.deepEqual(
    { ...frame },
    { name: 'ToolkitVFrame_002', orient: 'v', ...AREA, z: 0, opacity: 1, hidden: false, stroke: null, mask: null },
  )
  assert.equal(frame.node, node)
  assert.equal(Object.getOwnPropertyDescriptor(frame, 'node').enumerable, false)
})

test('a layer is a frame by its name alone', () => {
  const names = ['ToolkitHFrame_1', 'toolkitvframe', 'Background', undefined, 'TOOLKITHFRAME']
  const frames = collectFrames(names.map((name) => ({ name, ...BOX })))
  assert.deepEqual(
    frames.map((frame) => [frame.name, frame.orient]),
    [
      ['ToolkitHFrame_1', 'h'],
      ['toolkitvframe', 'v'],
      ['TOOLKITHFRAME', 'h'],
    ],
  )
})

test('opacity is the layer’s own, including 0, or 1 when it has none', () => {
  const frames = collectFrames([0.5, 0, undefined].map((opacity) => ({ name: FRAME, ...BOX, opacity })))
  assert.deepEqual(
    frames.map((frame) => frame.opacity),
    [0.5, 0, 1],
  )
})

test('z counts the frames found, so a layer with no area takes no slot', () => {
  const frames = collectFrames([
    { name: FRAME, ...BOX },
    { name: FRAME },
    { name: 'Background', ...BOX },
    { name: FRAME, ...BOX },
    { name: FRAME, ...BOX },
  ])
  assert.deepEqual(
    frames.map((frame) => frame.z),
    [0, 1, 2],
  )
})

test('z carries on from the list it is given', () => {
  const out = [{ name: 'earlier' }]
  assert.equal(collectFrames([{ name: FRAME, ...BOX }], out), out)
  assert.equal(out[1].z, 1)
})

test('children come after their layer, frames or not, and inherit hiding', () => {
  const inside = { name: 'toolkitvframe2', ...BOX }
  const frames = collectFrames([
    { name: 'Group', hidden: true, children: [inside] },
    { name: 'Group', children: [{ ...inside, hidden: true }, inside] },
    { name: FRAME, ...BOX, children: [inside] },
    { name: FRAME, ...BOX, hidden: true, children: [inside] },
  ])
  assert.deepEqual(
    frames.map((frame) => [frame.orient, frame.hidden]),
    [
      ['v', true],
      ['v', true],
      ['v', false],
      ['h', false],
      ['v', false],
      ['h', true],
      ['v', true],
    ],
  )
})

test('a hidden parent can be given from outside, and no layers is no frames', () => {
  assert.equal(collectFrames([{ name: FRAME, ...BOX }], [], true)[0].hidden, true)
  assert.deepEqual(collectFrames(undefined), [])
  assert.deepEqual(collectFrames(null), [])
})

test('a frame’s stroke comes from its effects', () => {
  const stroke = { enabled: true, size: { value: 3 }, position: 'inside', color: { r: 1, g: 2, b: 3 }, opacity: 0.5 }
  const [frame] = collectFrames([{ name: FRAME, ...BOX, effects: { stroke } }])
  assert.deepEqual(frame.stroke, { size: 3, position: 'inside', color: '#010203', opacity: 0.5 })
})

// ─── shapeAlpha ──────────────────────────────────────────────────────────────

// The other channels hold 9, so reading the wrong one shows in the bytes.
const image = (width, height, ...alphas) => ({
  width,
  height,
  data: Uint8ClampedArray.from(alphas.flatMap((alpha) => [9, 9, 9, alpha])),
})
const grey = (width, height, ...values) => ({
  width,
  height,
  data: Uint8ClampedArray.from(values.flatMap((value) => [value, 9, 9, 9])),
})
const ONE = { x: 0, y: 0, w: 1, h: 1 }
const WIDE = { x: 0, y: 0, w: 2, h: 1 }
const TALL = { x: 0, y: 0, w: 1, h: 2 }
const SQUARE = { x: 0, y: 0, w: 2, h: 2 }
const OPAQUE = image(2, 2, 255, 255, 255, 255)
const LIT = grey(2, 2, 1, 2, 3, 4)

for (const [name, box, node, expected] of [
  ['neither image nor mask', ONE, {}, null],
  ['an image of width 0', ONE, { imageData: image(0, 1) }, null],
  ['an image of height 0', ONE, { imageData: image(1, 0) }, null],
  ['a fully opaque image', SQUARE, { imageData: OPAQUE }, null],
  ['partial alpha', SQUARE, { imageData: image(2, 2, 10, 20, 30, 40) }, [10, 20, 30, 40]],
  ['one row of a wider image', WIDE, { imageData: image(2, 2, 10, 20, 30, 40) }, [10, 20]],
  ['a frame off the image’s origin', { ...ONE, x: 1, y: 1 }, { imageData: image(2, 2, 10, 20, 30, 40) }, [40]],
  ['a layer off the origin', { ...ONE, x: 5, y: 6 }, { left: 4, top: 6, imageData: image(2, 1, 1, 40) }, [40]],
  ['a frame past the image’s left', { ...WIDE, x: -1 }, { imageData: OPAQUE }, [0, 255]],
  ['a frame past the image’s top', { ...TALL, y: -1 }, { imageData: OPAQUE }, [0, 255]],
  ['a frame past the image’s right', { ...WIDE, x: 1 }, { imageData: OPAQUE }, [255, 0]],
  ['a frame past the image’s bottom', { ...TALL, y: 1 }, { imageData: OPAQUE }, [255, 0]],
  ['a disabled mask', ONE, { mask: { disabled: true, imageData: grey(1, 1, 0) } }, null],
  ['a mask with no pixels', ONE, { mask: {} }, null],
  ['a mask of width 0', ONE, { mask: { imageData: grey(0, 1) } }, null],
  ['mask values, red channel first', SQUARE, { mask: { imageData: LIT } }, [1, 2, 3, 4]],
  ['a mask at its own position', { ...ONE, x: 2, y: 3 }, { mask: { left: 1, top: 2, imageData: LIT } }, [4]],
  [
    'a mask placed against the page',
    { ...ONE, x: 2, y: 3 },
    { left: 9, top: 9, mask: { left: 1, top: 2, positionRelativeToLayer: false, imageData: LIT } },
    [4],
  ],
  [
    'a mask placed against its layer',
    { ...ONE, x: 3, y: 5 },
    { left: 2, top: 3, mask: { left: 0, top: 1, positionRelativeToLayer: true, imageData: LIT } },
    [4],
  ],
  [
    'a mask placed against a layer at the origin',
    { ...ONE, x: 1, y: 2 },
    { mask: { left: 0, top: 1, positionRelativeToLayer: true, imageData: LIT } },
    [4],
  ],
  [
    'a mask against its layer, with no position of its own',
    { ...ONE, x: 3, y: 4 },
    { left: 2, top: 3, mask: { positionRelativeToLayer: true, imageData: LIT } },
    [4],
  ],
  ['outside the mask, its default', { ...ONE, x: 9 }, { mask: { defaultColor: 7, imageData: LIT } }, [7]],
  ['outside the mask, a default of 0', { ...ONE, x: 9 }, { mask: { defaultColor: 0, imageData: LIT } }, [0]],
  ['outside the mask, no default', { ...ONE, x: 9 }, { mask: { imageData: LIT } }, [0]],
  ['a text default, read as none', { ...ONE, x: 9 }, { mask: { defaultColor: '7', imageData: LIT } }, [0]],
  ['past the mask’s left', { ...WIDE, x: -1 }, { mask: { defaultColor: 7, imageData: LIT } }, [7, 1]],
  ['past the mask’s top', { ...TALL, y: -1 }, { mask: { defaultColor: 7, imageData: LIT } }, [7, 1]],
  ['past the mask’s right', { ...WIDE, x: 1 }, { mask: { defaultColor: 7, imageData: LIT } }, [2, 7]],
  ['past the mask’s bottom', { ...TALL, y: 1 }, { mask: { defaultColor: 7, imageData: LIT } }, [3, 7]],
  ['a mask all 255', ONE, { mask: { imageData: grey(1, 1, 255) } }, null],
  ['a mask with a default of 255', { ...ONE, x: 9 }, { mask: { defaultColor: 255, imageData: LIT } }, null],
  // (100 × 128 + 127) / 255 is 50.7 and truncates; (200 × 254 + 127) / 255 is 199.7.
  [
    'an image and mask together',
    WIDE,
    { imageData: image(2, 1, 100, 200), mask: { imageData: grey(2, 1, 128, 254) } },
    [50, 199],
  ],
  [
    'a mask at 255 leaves the image',
    WIDE,
    { imageData: image(2, 1, 100, 200), mask: { imageData: grey(2, 1, 255, 255) } },
    [100, 200],
  ],
  [
    'an opaque image leaves the mask',
    WIDE,
    { imageData: OPAQUE, mask: { imageData: grey(2, 1, 128, 255) } },
    [128, 255],
  ],
]) {
  test(`shapeAlpha reads ${name}`, () => {
    const shape = shapeAlpha({ ...box, node })
    assert.deepEqual(shape && [...shape], expected)
  })
}

// ─── templateArt ─────────────────────────────────────────────────────────────

const W = 40
const H = 30
const BUDGET = 900 * 1024 * 1024
const CHANGED_READ = 'The template changed before its verified bytes were read. Retry from a stable original.'
const CHANGED_BACKDROP = 'The template changed while its backdrop was made. Retry from a stable source.'
const NO_CMYK =
  'CMYK template frame masks cannot yet be verified. Convert and save the template as RGB before using it for album proofs.'
const NO_DEPTH =
  'High-depth template frame masks cannot yet be verified. Convert and save the template as 8-bit RGB before using it for album proofs.'

function pixels(width, height, rgb, alpha = () => 255) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([...rgb, alpha(x, y)], (y * width + x) * 4)
  return { width, height, data }
}
const LAYER = { left: 4, top: 4, right: 14, bottom: 14 }
const PLAIN = { name: 'ToolkitHFrame_001', ...LAYER, imageData: pixels(10, 10, [200, 0, 120]) }
const LEFT_HALF = (x) => (x < 5 ? 255 : 0)
const SHAPED = { ...PLAIN, imageData: pixels(10, 10, [200, 0, 120], LEFT_HALF) }
const BACKGROUND = { name: 'Background', left: 0, top: 0, right: W, bottom: H, imageData: pixels(W, H, [90, 90, 90]) }
const stroke = (position, opacity = 1) => ({
  stroke: [
    {
      enabled: true,
      present: true,
      position,
      fillType: 'color',
      blendMode: 'normal',
      opacity,
      size: { units: 'Pixels', value: 2 },
      color: { r: 255, g: 255, b: 255 },
    },
  ],
})

function psdBytes(children, shade = 90) {
  const composite = pixels(W, H, [shade, shade, shade])
  return Buffer.from(ag.writePsdBuffer({ width: W, height: H, imageData: composite, children }))
}
function template(bytes) {
  const file = path.join(tmpdir(), 'template.psd')
  fs.writeFileSync(file, bytes)
  return file
}
const sheet = (children) => template(psdBytes(children))
const patched = (bytes, at, value) => {
  bytes.writeUInt16BE(value, at)
  return bytes
}
const asCmyk = (bytes) => patched(bytes, 24, 4)
const at16Bits = (bytes) => patched(bytes, 22, 16)
const plainJson = (art) => JSON.parse(JSON.stringify(art))
const digestOf = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

// Each load has its own key source: `keys` answers the calls in turn, then the real one takes over.
function loaded({ keys = [], psdPixels = color.psdPixels } = {}) {
  const asked = []
  const contentFileKey = async (file) => {
    const answer = keys[asked.length]
    asked.push(file)
    return typeof answer === 'function' ? answer(file) : (answer ?? cache.contentFileKey(file))
  }
  const module = loadPrivate('../lib/psd_template.js', {
    names: ['inflight'],
    stubs: { './cache': { ...cache, contentFileKey }, './color': { ...color, psdPixels } },
  })
  return { templateArt: module.templateArt, inflight: module.__private.inflight, asked }
}
const { templateArt } = loaded()
const folderOf = async (file) => path.join(cacheDir, 'templates', await cache.contentFileKey(file))
const decodes = (t) => t.mock.method(ag, 'readPsd')

test('a template that isn’t on disk says so', async () => {
  const file = path.join(tmpdir(), 'gone.psd')
  await assert.rejects(templateArt(file), { message: 'The template gone.psd isn’t on disk.'.replace('’', "'") })
})

test('a valid cache entry comes back without a decode', async (t) => {
  const file = sheet([SHAPED])
  const first = await templateArt(file)
  const reads = decodes(t)
  const again = loaded()
  assert.deepEqual(await again.templateArt(file), plainJson(first))
  assert.equal(reads.mock.callCount(), 0)
  assert.equal(again.asked.length, 2, 'the key, then the check that the source held still')
})

test('a caller who already has the digest spares both hashes', async (t) => {
  const file = sheet([SHAPED])
  const sourceDigest = digestOf(file)
  const built = loaded()
  const first = await built.templateArt(file, 2400, { sourceDigest })
  assert.equal(built.asked.length, 1, 'only the check after the backdrop')
  const reads = decodes(t)
  const again = loaded()
  assert.deepEqual(await again.templateArt(file, 2400, { sourceDigest }), plainJson(first))
  assert.equal(reads.mock.callCount(), 0)
  assert.equal(again.asked.length, 0)
})

test('a digest that isn’t the file’s is found when the bytes are read', async () => {
  await assert.rejects(templateArt(sheet([PLAIN]), 2400, { sourceDigest: 'f'.repeat(64) }), { message: CHANGED_READ })
})

// The file is really there and its digest is right, so only its place can refuse it.
const movedBackdrop = (art, to) => {
  fs.copyFileSync(art.backdrop, to)
  art.backdrop = to
  art.artifactDigests[to] = digestOf(to)
}
const movedMask = (art, to) => {
  fs.copyFileSync(art.frames[0].mask, to)
  art.frames[0].mask = to
  art.artifactDigests[to] = digestOf(to)
}

for (const [name, change] of [
  [
    'a backdrop outside the folder',
    (art, dir) => movedBackdrop(art, path.join(path.dirname(dir), 'backdrop-2400.jpg')),
  ],
  ['a backdrop of another size', (art, dir) => movedBackdrop(art, path.join(dir, 'backdrop-1200.jpg'))],
  ['a mask with a bad name', (art, dir) => movedMask(art, path.join(dir, 'mask-a-0.png'))],
  ['a mask with a prefix', (art, dir) => movedMask(art, path.join(dir, 'xmask-2400-0.png'))],
  ['a mask with a suffix', (art, dir) => movedMask(art, path.join(dir, 'mask-2400-0.png.old'))],
  ['a mask in another folder', (art, dir) => movedMask(art, path.join(path.dirname(dir), 'mask-2400-0.png'))],
  ['another schema', (art) => (art.schema = 5)],
  ['another source', (art) => (art.sourceKey = 'elsewhere')],
  ['no digests', (art) => delete art.artifactDigests],
  ['a digest that differs', (art) => (art.artifactDigests[art.backdrop] = '0'.repeat(64))],
  ['a mask digest that differs', (art) => (art.artifactDigests[art.frames[0].mask] = '0'.repeat(64))],
  ['no frame list', (art) => delete art.frames],
]) {
  test(`a cache entry with ${name} is made again`, async (t) => {
    const file = sheet([SHAPED])
    const first = plainJson(await templateArt(file))
    const dir = await folderOf(file)
    const info = path.join(dir, 'art-2400.json')
    const edited = JSON.parse(fs.readFileSync(info, 'utf8'))
    change(edited, dir)
    fs.writeFileSync(info, JSON.stringify(edited))
    const reads = decodes(t)
    assert.deepEqual(plainJson(await templateArt(file)), first)
    assert.equal(reads.mock.callCount(), 2)
    assert.deepEqual(JSON.parse(fs.readFileSync(info, 'utf8')), first)
  })
}

test('broken JSON is made again', async (t) => {
  const file = sheet([PLAIN])
  const first = plainJson(await templateArt(file))
  fs.writeFileSync(path.join(await folderOf(file), 'art-2400.json'), '{')
  const reads = decodes(t)
  assert.deepEqual(plainJson(await templateArt(file)), first)
  assert.equal(reads.mock.callCount(), 2)
})

test('a listed file that is missing is made again', async (t) => {
  const file = sheet([SHAPED])
  const first = plainJson(await templateArt(file))
  fs.rmSync(first.frames[0].mask)
  const reads = decodes(t)
  assert.deepEqual(plainJson(await templateArt(file)), first)
  assert.equal(reads.mock.callCount(), 2)
  assert.ok(fs.existsSync(first.frames[0].mask))
})

test('a source that changes while the cache is checked is found by the decode', async () => {
  const file = sheet([PLAIN])
  await templateArt(file)
  const racing = loaded({
    keys: [
      undefined,
      (changing) => {
        fs.writeFileSync(changing, psdBytes([PLAIN], 120))
        return 'changed'
      },
    ],
  })
  await assert.rejects(racing.templateArt(file), { message: CHANGED_READ })
  assert.equal(racing.asked.length, 2)
})

test('a cache check that sees the source move rebuilds from the bytes it can verify', async () => {
  const file = sheet([PLAIN])
  const first = plainJson(await templateArt(file))
  const moving = loaded({ keys: [undefined, 'changed'] })
  assert.deepEqual(plainJson(await moving.templateArt(file)), first)
  assert.equal(moving.asked.length, 3)
})

test('bytes that don’t match the key are refused before anything is decoded', async (t) => {
  const reads = decodes(t)
  await assert.rejects(loaded({ keys: ['not-the-key'] }).templateArt(sheet([PLAIN])), { message: CHANGED_READ })
  assert.equal(reads.mock.callCount(), 0)
})

test('a source that changes during the backdrop leaves no cache entry', async () => {
  const file = sheet([PLAIN])
  const racing = loaded({ keys: [undefined, 'changed'] })
  await assert.rejects(racing.templateArt(file), { message: CHANGED_BACKDROP })
  assert.equal(fs.existsSync(path.join(await folderOf(file), 'art-2400.json')), false)
  assert.ok(fs.existsSync(path.join(await folderOf(file), 'backdrop-2400.jpg')))
})

test('a template with no layers decodes no pixels', async (t) => {
  const reads = decodes(t)
  const art = await templateArt(template(psd({ width: W, height: H })))
  assert.equal(reads.mock.callCount(), 1)
  assert.deepEqual(reads.mock.calls[0].arguments[1], {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
  })
  assert.deepEqual([art.width, art.height, art.scale, art.frames], [W, H, 1, []])
  assert.deepEqual(Object.keys(art.artifactDigests), [art.backdrop])
})

test('layers are decoded with their pixels, the composite still skipped', async (t) => {
  const reads = decodes(t)
  await templateArt(sheet([BACKGROUND]))
  assert.equal(reads.mock.callCount(), 2)
  assert.deepEqual(reads.mock.calls[1].arguments[1], {
    skipLayerImageData: false,
    skipCompositeImageData: true,
    skipThumbnail: true,
    useImageData: true,
  })
})

test('CMYK with frames is refused, from its own header', async (t) => {
  const reads = decodes(t)
  await assert.rejects(templateArt(template(asCmyk(psdBytes([PLAIN])))), { message: NO_CMYK })
  assert.equal(reads.mock.callCount(), 1)
})

test('CMYK layers are never decoded, and the colour mode is only changed on a copy', async (t) => {
  const reads = decodes(t)
  await assert.rejects(templateArt(template(asCmyk(psdBytes([BACKGROUND])))), {
    message: /^The CMYK sheet cannot be delivered safely \(the actual source profile is absent\)/,
  })
  assert.equal(reads.mock.callCount(), 1)
})

test('a file that ends at its colour mode is a CMYK header too', async () => {
  await assert.rejects(templateArt(template(asCmyk(psdBytes(undefined).subarray(0, 26)))), (error) => {
    assert.doesNotMatch(error.message, /CMYK/)
    return true
  })
})

test('CMYK with no frames makes a backdrop', async () => {
  const values = Buffer.alloc(f.W * f.H * 4, 30)
  const file = path.join(tmpdir(), 'cmyk.psd')
  f.rawPsd(file, { depth: 8, mode: 4, values, profile: await f.icc('cmyk'), compression: 1 })
  const art = await templateArt(file)
  assert.deepEqual(art.frames, [])
  assert.ok(fs.existsSync(art.backdrop))
})

test('16-bit with frames is refused', async (t) => {
  const reads = decodes(t)
  await assert.rejects(templateArt(template(at16Bits(psdBytes([PLAIN])))), { message: NO_DEPTH })
  assert.equal(reads.mock.callCount(), 1)
})

test('16-bit with no frames makes a backdrop', async () => {
  const values = new Uint16Array(f.W * f.H * 3).fill(30000)
  const file = path.join(tmpdir(), 'deep.psd')
  f.rawPsd(file, { values, profile: await f.icc('srgb') })
  const art = await templateArt(file)
  assert.deepEqual(art.frames, [])
  assert.ok(fs.existsSync(art.backdrop))
})

test('a hidden frame gets no mask', async () => {
  const file = sheet([{ ...SHAPED, hidden: true }, SHAPED])
  const art = await templateArt(file)
  assert.deepEqual(
    art.frames.map((frame) => [frame.hidden, frame.mask && path.basename(frame.mask)]),
    [
      [true, null],
      [false, 'mask-2400-1.png'],
    ],
  )
  assert.deepEqual(fs.readdirSync(await folderOf(file)).sort(), [
    'art-2400.json',
    'backdrop-2400.jpg',
    'mask-2400-1.png',
  ])
})

test('masks and backdrops are named for their size', async () => {
  const file = sheet([SHAPED])
  const art = await templateArt(file, 20)
  assert.deepEqual(art.scale, 0.5)
  assert.deepEqual(
    [path.basename(art.backdrop), path.basename(art.frames[0].mask)],
    ['backdrop-20.jpg', 'mask-20-0.png'],
  )
  assert.ok(fs.existsSync(path.join(await folderOf(file), 'art-20.json')))
})

// `extra` pixels on top of a document that, with its layers replaced, decodes to exactly the budget.
function layersOfArea(t, extra) {
  const realRead = ag.readPsd
  const composite = W * H
  const rows = 1200
  return t.mock.method(ag, 'readPsd', (bytes, options) => {
    const read = realRead(bytes, options)
    if (options.skipLayerImageData) {
      const columns = (BUDGET / 4 - composite) / rows
      const huge = { name: 'Huge', left: 0, top: 0, right: columns, bottom: rows }
      read.children = [huge, ...(extra ? [{ name: 'Tiny', left: 0, top: 0, right: 1, bottom: 1 }] : [])]
    }
    return read
  })
}

test('exactly the decoding budget still decodes the layers', async (t) => {
  const reads = layersOfArea(t, 0)
  await templateArt(sheet([SHAPED]))
  assert.equal(reads.mock.callCount(), 2)
})

test('over the decoding budget, frames are drawn as rectangles', async (t) => {
  const realRead = ag.readPsd
  const reads = t.mock.method(ag, 'readPsd', (bytes, options) => {
    const read = realRead(bytes, options)
    read.children[0].right = 30000
    read.children[0].bottom = 30000
    return read
  })
  const art = await templateArt(sheet([SHAPED]))
  assert.equal(reads.mock.callCount(), 1)
  assert.equal(art.frames[0].mask, null)
})

test('one pixel over the decoding budget is over it', async (t) => {
  const reads = layersOfArea(t, 1)
  await templateArt(sheet([SHAPED]))
  assert.equal(reads.mock.callCount(), 1)
})

test('an inside stroke is revealed, and an outside one isn’t', async () => {
  const art = await templateArt(
    sheet([
      { ...PLAIN, effects: stroke('inside') },
      { ...PLAIN, effects: stroke('outside') },
    ]),
  )
  const [inside, outside] = art.frames
  assert.equal(inside.stroke.revealed, true)
  assert.ok(inside.mask)
  assert.equal('revealed' in outside.stroke, false)
  assert.equal(outside.mask, null)
})

test('a mask that isn’t a stroke leaves the stroke alone', async () => {
  const art = await templateArt(sheet([{ ...SHAPED, effects: stroke('outside') }]))
  assert.ok(art.frames[0].mask)
  assert.equal('revealed' in art.frames[0].stroke, false)
})

test('two callers at once share one build, and the entry leaves afterwards', async (t) => {
  const file = sheet([SHAPED])
  const reads = decodes(t)
  const shared = loaded()
  const [one, two] = await Promise.all([shared.templateArt(file), shared.templateArt(file)])
  assert.equal(one, two)
  assert.equal(reads.mock.callCount(), 2)
  assert.equal(shared.inflight.size, 0)
})

test('a failed build leaves no entry behind', async () => {
  const racing = loaded({ keys: ['not-the-key'] })
  await assert.rejects(racing.templateArt(sheet([PLAIN])), { message: CHANGED_READ })
  assert.equal(racing.inflight.size, 0)
})

test('a mask is white, its alpha the frame’s shape, row by row', async () => {
  const art = await templateArt(sheet([SHAPED]))
  const { data, info } = await sharp(art.frames[0].mask).raw().toBuffer({ resolveWithObject: true })
  assert.deepEqual([info.width, info.height, info.channels], [10, 10, 4])
  const expected = []
  for (let i = 0; i < 100; i++) expected.push(255, 255, 255, i % 10 < 5 ? 255 : 0)
  assert.deepEqual([...data], expected)
})

test('every file listed in the entry has its digest', async () => {
  const art = await templateArt(sheet([SHAPED]))
  const listed = Object.fromEntries([art.backdrop, art.frames[0].mask].map((file) => [file, digestOf(file)]))
  assert.deepEqual(art.artifactDigests, listed)
})

test('the backdrop is the composite, flattened and sRGB-tagged at the scaled size', async () => {
  const art = await templateArt(sheet([PLAIN]), 20)
  const backdrop = sharp(art.backdrop)
  const { width, height, icc } = await backdrop.metadata()
  assert.deepEqual([width, height], [20, 15])
  assert.deepEqual(icc, await f.icc('srgb'))
  const { data } = await backdrop.raw().toBuffer({ resolveWithObject: true })
  assert.ok(Math.abs(data[0] - 90) <= 2, String(data[0]))
})

test('raw pixels from the composite reach the encoder as raw, flattened on white', async () => {
  const input = Buffer.alloc(W * H * 4, 200)
  const psdPixels = async () => ({ input, raw: { width: W, height: H, channels: 4 }, width: W, height: H })
  const art = await loaded({ psdPixels }).templateArt(sheet([PLAIN]))
  const { data } = await sharp(art.backdrop).raw().toBuffer({ resolveWithObject: true })
  // 200 at 200/255 coverage over white: 200 × 200/255 + 255 × 55/255 is 211.9.
  assert.ok(Math.abs(data[0] - 212) <= 2, String(data[0]))
})

test('a backdrop that can’t be encoded still releases the composite', async () => {
  let cleaned = 0
  const psdPixels = async () => ({
    input: Buffer.from('not an image'),
    width: 2,
    height: 2,
    cleanup: async () => cleaned++,
  })
  await assert.rejects(loaded({ psdPixels }).templateArt(sheet([PLAIN])), /unsupported image format/)
  assert.equal(cleaned, 1)
})

test('a composite is released once it has been encoded', async () => {
  let cleaned = 0
  const input = Buffer.alloc(W * H * 4, 200)
  const raw = { width: W, height: H, channels: 4 }
  const psdPixels = async () => ({ input, raw, width: W, height: H, cleanup: async () => cleaned++ })
  await loaded({ psdPixels }).templateArt(sheet([PLAIN]))
  assert.equal(cleaned, 1)
})
