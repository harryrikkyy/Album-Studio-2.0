'use strict'

// Every route through drawing a proof. `templateArt` answers by row and the photos are real files,
// so each picture comes out of real sharp. JPEG blurs a colour a little, so a pixel is checked
// against a literal within a tolerance, well inside its block.

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const { tmpdir } = require('./fixtures')

process.env.ALBUM_STUDIO_CACHE_DIR = tmpdir()

const sharp = require('sharp')
const cache = require('../lib/cache')
const inputs = require('../lib/inputs')
const stages = require('../lib/private_stage')
const psdTemplate = require('../lib/psd_template')
const raw = require('../lib/raw')
const renderer = require('../../../src/proof_renderer')
const { loadPrivate } = require('./load_private')

const RED = [255, 0, 0]
const GREEN = [0, 255, 0]
const BLUE = [0, 0, 255]
const WHITE = [255, 255, 255]
const BLACK = [0, 0, 0]
const FRAME = { name: 'ToolkitHFrame_001', orient: 'h', z: 1, x: 20, y: 10, w: 40, h: 40, opacity: 1 }
const INSIDE = [40, 30]
const OUTSIDE = [5, 5]
const EDITS = { pageLayerEdits: { 4: { 'layer/1': { hidden: true } } } }
const EDGE = 2400
const BUDGET = 256 * 1024 * 1024

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const solid = (rgb, w = 40, h = 40) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } })
    .png()
    .toBuffer()

/** A 40×40 mask, clear on its left half and solid on its right. */
function halfMask() {
  const data = Buffer.alloc(40 * 40 * 4)
  for (let at = 0; at < data.length; at += 4) if ((at / 4) % 40 >= 20) data[at + 3] = 255
  return sharp(data, { raw: { width: 40, height: 40, channels: 4 } })
    .png()
    .toBuffer()
}

async function picture(input) {
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return {
    size: [info.width, info.height],
    at: ([x, y]) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)],
  }
}

function looksLike(actual, expected, tolerance = 12) {
  assert.ok(
    actual.every((value, i) => Math.abs(value - expected[i]) <= tolerance),
    `${actual} is not close to ${expected}`,
  )
}

/**
 * A 100×60 page, spread 4, on a white preview, with one frame and one red photo. A row changes what
 * it tests with `photos` ({ id: colour or file bytes }), `records` (album records laid over the
 * photos'), `missing` (ids the album has lost), `art`, `frames`, `ws`, `preview`, `backdrop`, `mask`,
 * `previewable`, `tree`, `rendered`, `svg`, `build` (replaces `buildPhotoLayer`) and `read`
 * (replaces the buffered read).
 */
async function scene(row = {}) {
  const dir = tmpdir()
  const place = (name, bytes) => {
    const file = path.join(dir, name)
    fs.writeFileSync(file, bytes)
    return file
  }
  const seen = {
    art: [],
    frozen: [],
    paths: [],
    read: [],
    built: [],
    jobs: [],
    trees: [],
    svg: [],
    dirs: [],
    stage: [],
  }
  const file = place('page.psd', 'template bytes')
  const digest = sha('template bytes')
  const album = { path: dir, photos: {} }
  const photoValues = []
  for (const [id, source] of Object.entries(row.photos || { a: RED })) {
    const bytes = Array.isArray(source) ? await solid(source) : source
    album.photos[id] = { thumb: place(`${id}.png`, bytes), orient: 'h', ...(row.records || {})[id] }
    photoValues.push([id, 'name', sha(bytes)])
  }
  const preview = row.preview === undefined ? WHITE : row.preview
  const spread = {
    n: 4,
    template: { file, ...(preview ? { preview: place('preview.png', await solid(preview)) } : {}) },
    photoIds: [...(row.missing || []), ...Object.keys(album.photos)],
  }
  const art = {
    sourceKey: cache.contentKey(file, digest),
    width: 100,
    height: 60,
    backdrop: null,
    frames: row.frames || [FRAME],
    artifactDigests: {},
    ...row.art,
  }
  if (row.backdrop) {
    const bytes = await solid(row.backdrop, 200, 120)
    art.backdrop = place('backdrop.png', bytes)
    art.artifactDigests[art.backdrop] = sha(bytes)
  }
  if (row.mask) {
    const bytes = await halfMask()
    const mask = place('mask.png', bytes)
    art.artifactDigests[mask] = sha(bytes)
    art.frames = art.frames.map((f) => ({ ...f, mask }))
  }
  const input = ['edition', digest, photoValues]
  const ws = row.ws || {}
  const out = path.join(dir, 'proofs', 'pages', 'live_page_004.jpg')
  if (ws.pageLayerEdits) fs.mkdirSync(path.dirname(out), { recursive: true })
  const { drawProof } = loadPrivate('../lib/proofs.js', {
    stubs: {
      './inputs': {
        ...inputs,
        spreadInputs: async (...args) => {
          seen.inputs = args
          return input
        },
      },
      './psd_template': {
        ...psdTemplate,
        templateArt: async (...args) => {
          seen.art.push(args)
          return art
        },
      },
      './private_stage': {
        ...stages,
        withPrivateStage: (parent, prefix, work) =>
          stages.withPrivateStage(parent, prefix, (stage) => {
            seen.stage.push(parent, prefix, stage.path)
            const { snapshot } = stage
            stage.snapshot = async (source, sum) => {
              seen.frozen.push([path.basename(source), sum])
              const frozen = await snapshot(source, sum)
              seen.paths.push(frozen)
              return frozen
            }
            return work(stage)
          }),
      },
      './cache': {
        ...cache,
        readVerifiedBuffer: async (source, sum, remaining) => {
          seen.read.push([path.basename(source), sum, remaining])
          if (row.read) return row.read(source, sum, remaining)
          return cache.readVerifiedBuffer(source, sum, remaining)
        },
      },
      './raw': {
        ...raw,
        isRaw: (name) => name.endsWith('.cr2'),
        previewable: async (name, dirs) => {
          seen.dirs.push(dirs)
          return row.previewable ? row.previewable({ dir, place }) : null
        },
      },
      '../../../src/proof_renderer': {
        ...renderer,
        buildPhotoLayer: async (...args) => {
          seen.built.push(args[1])
          return (row.build || renderer.buildPhotoLayer)(...args)
        },
        renderPageProof: async (job) => {
          seen.jobs.push(job)
          fs.writeFileSync(job.outputPath, 'layered proof')
          return row.rendered || { ok: true }
        },
      },
      '../../../src/psd_layers': {
        readPsdLayerTree: async (...args) => {
          seen.trees.push(args)
          return row.tree === undefined ? { ok: true, layers: ['layer'] } : row.tree
        },
      },
      '../../../src/overlay_render': {
        buildOverlaySvg: (...args) => {
          seen.svg.push(args)
          return row.svg || ''
        },
      },
    },
  })
  return {
    dir,
    out,
    seen,
    draw: (options) => drawProof(spread, album, ws, out, { inputs: input, ...options }),
    digests: Object.fromEntries(photoValues.map(([id, , sum]) => [id, sum])),
    templateDigest: digest,
    backdropDigest: art.backdrop && art.artifactDigests[art.backdrop],
    spread,
    album,
    ws,
    art,
    file,
  }
}

const drawn = async (row, options) => {
  const s = await scene(row)
  const result = await s.draw(options)
  return { ...s, result, page: await picture(result.jpeg || s.out) }
}

// ── the template and its snapshots ──────────────────────────────────────────

test('the template changing before its snapshot stops the draw', async () => {
  const s = await scene({ art: { sourceKey: 'another revision' } })
  await assert.rejects(s.draw(), { message: /^The template changed before its proof snapshot was made\./ })
})

test('inputs not handed in are read from the spread', async () => {
  const s = await scene()
  await s.draw({ inputs: undefined })
  assert.deepEqual(s.seen.inputs, [s.spread, s.album, s.ws])
})

test('inputs handed in are used as they are', async () => {
  const s = await scene()
  await s.draw()
  assert.equal(s.seen.inputs, undefined)
})

test('a proof draws in a private stage under the cache, with the template frozen first', async () => {
  const s = await scene()
  await s.draw()
  assert.deepEqual(s.seen.stage.slice(0, 2), [cache.cacheRoot(), 'proof-sources-'])
  assert.deepEqual(s.seen.art, [[s.file, EDGE, undefined]])
  assert.deepEqual(s.seen.frozen, [
    ['page.psd', s.templateDigest],
    ['a.png', s.digests.a],
  ])
})

test('a buffered preview freezes no template and reads the art by its digest', async () => {
  const s = await scene()
  await s.draw({ buffered: true })
  assert.deepEqual(s.seen.art, [[s.file, EDGE, { sourceDigest: s.templateDigest }]])
  assert.deepEqual(s.seen.frozen, [])
  assert.deepEqual(
    s.seen.read.map((r) => r[0]),
    ['a.png'],
  )
})

test('art is frozen before the frames: backdrop, then masks, then photos', async () => {
  const s = await scene({ backdrop: BLUE, mask: true })
  await s.draw()
  assert.deepEqual(
    s.seen.frozen.map((f) => f[0]),
    ['page.psd', 'backdrop.png', 'mask.png', 'a.png'],
  )
  assert.equal(s.seen.frozen[1][1], s.backdropDigest)
  assert.equal(s.art.frames[0].mask.endsWith('mask.png'), true, 'the art the cache holds keeps its own path')
})

test('a frame with no mask freezes no mask', async () => {
  const s = await scene()
  await s.draw()
  assert.equal(
    s.seen.frozen.some((f) => f[0] === 'mask.png'),
    false,
  )
})

test('a page over the edge limit draws scaled to it', async () => {
  const { page } = await drawn({
    art: { width: 4800, height: 3000 },
    frames: [{ ...FRAME, x: 1000, y: 1000, w: 800, h: 800 }],
  })
  assert.deepEqual(page.size, [2400, 1500])
  looksLike(page.at([700, 700]), RED)
  looksLike(page.at([300, 300]), WHITE)
})

// ── the page under the photos ───────────────────────────────────────────────

test('the page starts from the backdrop, ahead of a preview', async () => {
  const { page } = await drawn({ backdrop: BLUE, preview: GREEN })
  assert.deepEqual(page.size, [100, 60])
  looksLike(page.at(OUTSIDE), BLUE)
})

test('with no backdrop the page starts from the preview', async () => {
  const { page } = await drawn({ preview: GREEN, ws: { pageBackgrounds: { 4: '#0000ff' } } })
  assert.deepEqual(page.size, [100, 60])
  looksLike(page.at(OUTSIDE), GREEN)
})

const BLANK = { preview: null, photos: {}, frames: [] }

test('with neither the page is its background colour', async () => {
  const { page } = await drawn({ ...BLANK, ws: { pageBackgrounds: { 4: '#102030' } } })
  assert.deepEqual(page.size, [100, 60])
  looksLike(page.at(OUTSIDE), [16, 32, 48])
})

test('with no colour the page is white', async () => {
  const { page } = await drawn({ ...BLANK, ws: { pageBackgrounds: { 5: '#102030' } } })
  looksLike(page.at(OUTSIDE), WHITE)
})

test('an invalid colour is white', async () => {
  const { page } = await drawn({ ...BLANK, ws: { pageBackgrounds: { 4: 'teal' } } })
  looksLike(page.at(OUTSIDE), WHITE)
})

test('a photo on a blank page is drawn over the page colour', async () => {
  const { page, result } = await drawn({ preview: null, ws: { pageBackgrounds: { 4: '#102030' } } })
  assert.deepEqual(result, { skipped: [] })
  looksLike(page.at(OUTSIDE), [16, 32, 48])
  looksLike(page.at(INSIDE), RED)
})

test('a buffered preview draws a photo on a blank page too', async () => {
  const row = { preview: null, ws: { pageBackgrounds: { 4: '#102030' } } }
  const { page, result } = await drawn(row, { buffered: true })
  assert.deepEqual(result.skipped, [])
  looksLike(page.at(OUTSIDE), [16, 32, 48])
  looksLike(page.at(INSIDE), RED)
})

test('with no layers the page is the base alone', async () => {
  const { page, result } = await drawn({ ...BLANK, backdrop: BLUE })
  assert.deepEqual(result, { skipped: [] })
  looksLike(page.at(INSIDE), BLUE)
})

// ── photos ──────────────────────────────────────────────────────────────────

test('a photo gone from the album is skipped, and the next one takes the frame', async () => {
  const { page, result, seen } = await drawn({ missing: ['gone'], photos: { b: BLUE } })
  assert.deepEqual(result, { skipped: [] })
  assert.equal(seen.built.length, 1)
  looksLike(page.at(INSIDE), BLUE)
})

test('a frame with nothing to show keeps the template', async () => {
  const { page, seen } = await drawn({ missing: ['gone'], photos: {}, backdrop: BLUE })
  assert.equal(seen.built.length, 0)
  looksLike(page.at(INSIDE), BLUE)
})

const rawPhoto =
  (bytes, extra) =>
  async ({ place }) => ({ file: place('developed.png', bytes), rotation: 0, ...extra })

test('a developed RAW that changed before its snapshot stops the draw', async () => {
  const bytes = await solid(RED)
  const s = await scene({
    photos: { a: bytes },
    records: { a: { original: 'shot.cr2' } },
    previewable: rawPhoto(bytes, { sourceKey: 'another revision' }),
  })
  await assert.rejects(s.draw(), { message: /^The photo changed before its proof snapshot was made\./ })
})

test('a developed RAW is keyed on its original, not on its thumbnail', async () => {
  const bytes = await solid(RED)
  const s = await scene({
    photos: { a: bytes },
    records: { a: { original: 'shot.cr2' } },
    previewable: rawPhoto(bytes, { sourceKey: cache.contentKey('shot.cr2', sha(bytes)) }),
  })
  assert.deepEqual(await s.draw(), { skipped: [] })
})

test('a developed RAW with no key is not checked', async () => {
  const bytes = await solid(RED)
  const { page } = await drawn({
    photos: { a: bytes },
    records: { a: { original: 'shot.cr2' } },
    previewable: rawPhoto(bytes),
  })
  looksLike(page.at(INSIDE), RED)
})

test('a developed RAW names its own digest for the snapshot', async () => {
  const bytes = await solid(BLUE)
  const s = await scene({
    records: { a: { original: 'shot.cr2' } },
    previewable: rawPhoto(bytes, { digest: sha(bytes) }),
  })
  await s.draw()
  assert.deepEqual(s.seen.frozen.at(-1), ['developed.png', sha(bytes)])
})

test('a photo with no digest of its own freezes the one the inputs give', async () => {
  const s = await scene()
  await s.draw()
  assert.deepEqual(s.seen.frozen.at(-1), ['a.png', s.digests.a])
})

test("RAW previews look in the job's output folder, then the shared cache", async () => {
  const s = await scene({ records: { a: { original: 'shot.cr2' } }, ws: { outputToken: '/picked/folder' } })
  await s.draw()
  assert.deepEqual(s.seen.dirs, [
    {
      developedDir: path.join('/picked/folder', '.album-studio', 'raw'),
      previewDir: path.join(cache.cacheRoot(), 'raw-previews'),
    },
  ])
})

test("with no output folder RAW previews look in the album's exports", async () => {
  const s = await scene({ records: { a: { original: 'shot.cr2' } } })
  await s.draw()
  assert.equal(s.seen.dirs[0].developedDir, path.join(s.dir, 'exports', '.album-studio', 'raw'))
})

test('placement, adjustment and rotation reach the renderer, the turns adding up', async () => {
  const bytes = await solid(RED)
  const placement = { zoom: 2 }
  const adjust = { exposure: 10 }
  const s = await scene({
    photos: { a: bytes },
    records: { a: { original: 'shot.cr2', orient: 'v' } },
    frames: [{ ...FRAME, orient: 'v', name: 'ToolkitVFrame_001' }],
    previewable: async ({ place }) => ({ file: place('developed.png', bytes), rotation: 270 }),
    ws: { imageRotations: { a: 180 }, imagePlacements: { a: placement }, imageAdjustments: { a: adjust } },
  })
  await s.draw()
  assert.deepEqual(s.seen.built, [
    {
      filePath: s.seen.paths.at(-1),
      fallbackPath: null,
      orient: 'v',
      rotation: 90,
      placement,
      adjust,
      fastEncode: false,
    },
  ])
})

test('with none of those a photo goes in plain', async () => {
  const s = await scene({ ws: { imageRotations: {}, imagePlacements: {}, imageAdjustments: {} } })
  await s.draw({ buffered: true })
  const [photo] = s.seen.built
  assert.deepEqual(
    { ...photo, filePath: null },
    {
      filePath: null,
      fallbackPath: null,
      orient: 'h',
      rotation: 0,
      placement: null,
      adjust: null,
      fastEncode: true,
    },
  )
  assert.ok(Buffer.isBuffer(photo.filePath))
})

test('a rotation that is not a number counts as none', async () => {
  const s = await scene({ ws: { imageRotations: { a: 'sideways' } } })
  await s.draw()
  assert.equal(s.seen.built[0].rotation, 0)
})

test("a page's overlays and background are its own", async () => {
  const s = await scene({
    ws: { pageOverlays: { 3: ['other'], 4: ['mine'] }, pageBackgrounds: { 4: '#000000' } },
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"/>',
  })
  await s.draw()
  assert.deepEqual(s.seen.svg, [[['mine'], 100, 60]])
})

test('a page with no overlays of its own hands over an empty list', async () => {
  const s = await scene({ ws: { pageOverlays: { 3: ['other'] } } })
  await s.draw()
  assert.deepEqual(s.seen.svg, [[[], 100, 60]])
})

test('overlays are drawn over the photos', async () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect x="30" y="20" width="20" height="20" fill="#0000ff"/></svg>'
  const { page } = await drawn({ svg })
  looksLike(page.at(INSIDE), BLUE)
  looksLike(page.at([25, 15]), RED)
})

// ── frames ──────────────────────────────────────────────────────────────────

test('a hidden frame draws nothing and tries nothing', async () => {
  const { page, seen, result } = await drawn({ frames: [{ ...FRAME, hidden: true }] })
  assert.equal(seen.built.length, 0)
  assert.deepEqual(result, { skipped: [] })
  looksLike(page.at(INSIDE), WHITE)
})

test('a mask decides where a frame shows its photo', async () => {
  const { page } = await drawn({ mask: true })
  looksLike(page.at([25, 30]), WHITE)
  looksLike(page.at([55, 30]), RED)
})

test("a mask wins over a frame's opacity, which it already holds", async () => {
  const { page } = await drawn({ mask: true, photos: { a: BLACK }, frames: [{ ...FRAME, opacity: 0.5 }] })
  looksLike(page.at([55, 30]), BLACK)
})

test('a part-opaque frame lets the page through', async () => {
  const { page } = await drawn({ photos: { a: BLACK }, frames: [{ ...FRAME, opacity: 0.5 }] })
  looksLike(page.at(INSIDE), [128, 128, 128])
})

test('a fully opaque frame covers the page', async () => {
  const { page } = await drawn({ photos: { a: BLACK } })
  looksLike(page.at(INSIDE), BLACK)
})

const STROKE = { size: 8, color: '#00ff00', opacity: 1, position: 'center' }

test('a stroke is drawn over its photo', async () => {
  const { page } = await drawn({ frames: [{ ...FRAME, stroke: STROKE }] })
  looksLike(page.at([20, 30]), GREEN, 40)
  looksLike(page.at(INSIDE), RED)
})

test('a stroke the template already shows is not drawn again', async () => {
  const { page } = await drawn({ frames: [{ ...FRAME, stroke: { ...STROKE, revealed: true } }] })
  looksLike(page.at([18, 30]), WHITE)
})

test('a frame with no stroke has no edge', async () => {
  const { page } = await drawn()
  looksLike(page.at([18, 30]), WHITE)
})

test('a stroke of no size is dropped', async () => {
  const { page, result } = await drawn({ frames: [{ ...FRAME, stroke: { ...STROKE, size: 0 } }] })
  assert.deepEqual(result, { skipped: [] })
  looksLike(page.at([18, 30]), WHITE)
})

test('a frame and stroke entirely off the page are dropped', async () => {
  const { page, result } = await drawn({ frames: [{ ...FRAME, x: -80, stroke: STROKE }] })
  assert.deepEqual(result, { skipped: [] })
  looksLike(page.at([1, 30]), WHITE)
})

test('a photo that cannot be read is reported and the others are drawn', async () => {
  const { page, result } = await drawn({
    photos: { a: Buffer.from('not a picture'), b: BLUE },
    frames: [FRAME, { ...FRAME, name: 'ToolkitHFrame_002', z: 2, x: 62, w: 30 }],
  })
  assert.equal(result.skipped.length, 1)
  assert.match(result.skipped[0], /^unreadable source \[/)
  looksLike(page.at(INSIDE), WHITE)
  looksLike(page.at([75, 30]), BLUE)
})

test("a buffered photo that cannot be read is skipped, today with the renderer's own slip for a message", async () => {
  const { page, result } = await drawn({ photos: { a: Buffer.from('not a picture') } }, { buffered: true })
  assert.deepEqual(result.skipped, ['s.split is not a function'])
  looksLike(page.at(INSIDE), WHITE)
})

test('frames decode three at a time and draw in layer order', async () => {
  const colours = [RED, GREEN, BLUE, [255, 255, 0], [0, 255, 255], [255, 0, 255], BLACK]
  const photos = Object.fromEntries(colours.map((colour, i) => [`p${i}`, colour]))
  const frames = colours.map((_, i) => ({
    ...FRAME,
    name: `ToolkitHFrame_00${i}`,
    z: i,
    x: 10 * i,
    w: 20,
  }))
  let open = 0,
    most = 0
  const build = async (...args) => {
    most = Math.max(most, ++open)
    await new Promise((resolve) => setImmediate(resolve))
    open--
    return renderer.buildPhotoLayer(...args)
  }
  const { page } = await drawn({ photos, frames, build })
  assert.equal(most, 3)
  colours.forEach((colour, i) => looksLike(page.at([10 * i + 5, 30]), colour, 40))
})

// ── pages with layer edits ──────────────────────────────────────────────────

test('layer edits hand the page to the shared renderer', async () => {
  const s = await scene({
    backdrop: BLUE,
    preview: GREEN,
    ws: { ...EDITS, pageOverlays: { 4: ['mine'] }, pageBackgrounds: { 4: '#000000' } },
  })
  assert.deepEqual(await s.draw(), { skipped: [] })
  assert.equal(fs.readFileSync(s.out, 'utf8'), 'layered proof')
  const [job] = s.seen.jobs
  const [template, backdrop, photo] = s.seen.paths
  const outputPath = path.join(s.seen.stage[2], 'proof.jpg')
  assert.deepEqual(s.seen.trees, [[template]])
  assert.deepEqual(job, {
    templatePath: template,
    templatePreviewPath: backdrop,
    frames: [{ ...FRAME }],
    canvasWidth: 100,
    canvasHeight: 60,
    photos: [
      {
        filePath: photo,
        fallbackPath: null,
        orient: 'h',
        rotation: 0,
        placement: null,
        adjust: null,
        fastEncode: false,
      },
    ],
    outputPath,
    maxEdge: EDGE,
    smartCrop: false,
    overlays: ['mine'],
    pageBackground: '#000000',
    layerEdits: EDITS.pageLayerEdits[4],
    psdLayers: ['layer'],
  })
  assert.equal(s.seen.built.length, 0)
})

test("with no backdrop the shared renderer gets the template's preview", async () => {
  const s = await scene({ preview: GREEN, ws: EDITS })
  await s.draw()
  assert.equal(s.seen.jobs[0].templatePreviewPath, s.spread.template.preview)
})

test('a tree that could not be read leaves the layers out', async () => {
  const s = await scene({ tree: { ok: false, layers: ['stale'] }, ws: EDITS })
  await s.draw()
  assert.equal(s.seen.jobs[0].psdLayers, null)
})

test('no tree at all leaves the layers out', async () => {
  const s = await scene({ tree: null, ws: EDITS })
  await s.draw()
  assert.equal(s.seen.jobs[0].psdLayers, null)
})

test('the shared renderer failing stops the draw with its reason', async () => {
  const s = await scene({ rendered: { ok: false, error: 'the layers would not stack' }, ws: EDITS })
  await assert.rejects(s.draw(), { message: /^the layers would not stack/ })
  assert.equal(fs.existsSync(s.out), false)
})

test('photos the shared renderer skipped come back as their messages', async () => {
  const s = await scene({ rendered: { ok: true, skipped: [{ error: 'one' }, { error: 'two' }] }, ws: EDITS })
  assert.deepEqual(await s.draw(), { skipped: ['one', 'two'] })
})

test('a buffered preview with layer edits goes the unbuffered way', async () => {
  const s = await scene({ ws: EDITS })
  assert.deepEqual(await s.draw({ buffered: true }), { skipped: [] })
  assert.equal(fs.readFileSync(s.out, 'utf8'), 'layered proof')
  assert.deepEqual(s.seen.read, [])
})

test('an empty set of edits is no edits', async () => {
  const s = await scene({ ws: { pageLayerEdits: { 4: {} } } })
  const result = await s.draw({ buffered: true })
  assert.deepEqual(Object.keys(result), ['skipped', 'jpeg'])
  assert.equal(s.seen.jobs.length, 0)
})

test('an empty set of edits draws the flat page unbuffered too', async () => {
  const s = await scene({ ws: { pageLayerEdits: { 4: {} } } })
  await s.draw()
  assert.equal(s.seen.jobs.length, 0)
  looksLike((await picture(s.out)).at(INSIDE), RED)
})

test("another page's edits are not this page's", async () => {
  const s = await scene({ ws: { pageLayerEdits: { 5: EDITS.pageLayerEdits[4] } } })
  await s.draw()
  assert.equal(s.seen.jobs.length, 0)
})

// ── where the picture goes ──────────────────────────────────────────────────

test('a buffered preview returns its picture and writes nothing', async () => {
  const { dir, out, result, page } = await drawn({}, { buffered: true })
  assert.deepEqual(Object.keys(result), ['skipped', 'jpeg'])
  assert.deepEqual(result.skipped, [])
  looksLike(page.at(INSIDE), RED)
  assert.equal(fs.existsSync(path.dirname(out)), false)
  assert.equal(fs.existsSync(path.join(dir, 'proofs')), false)
})

test('a drawn proof lands at its name and leaves its stage empty', async () => {
  const { out, result, page, seen } = await drawn()
  assert.deepEqual(result, { skipped: [] })
  assert.equal(fs.existsSync(out), true)
  looksLike(page.at(INSIDE), RED)
  assert.equal(fs.existsSync(seen.stage[2]), false)
})

test("a file already at the proof's name stays, and the stage retires", async () => {
  const s = await scene()
  fs.mkdirSync(path.dirname(s.out), { recursive: true })
  fs.writeFileSync(s.out, 'kept')
  await assert.rejects(
    s.draw(),
    (error) => error.code === 'EEXIST' && /^Atomic file capture failed: /.test(error.message),
  )
  assert.equal(fs.readFileSync(s.out, 'utf8'), 'kept')
  assert.equal(fs.existsSync(s.seen.stage[2]), false)
})

test('a layered proof meeting a file at its name leaves it too', async () => {
  const s = await scene({ ws: EDITS })
  fs.writeFileSync(s.out, 'kept')
  await assert.rejects(s.draw(), (error) => error.code === 'EEXIST')
  assert.equal(fs.readFileSync(s.out, 'utf8'), 'kept')
})

test('a buffered preview counts what it has read against its budget', async () => {
  const s = await scene({ backdrop: BLUE })
  await s.draw({ buffered: true })
  const [first, second] = s.seen.read
  assert.deepEqual([first[0], first[2]], ['backdrop.png', BUDGET])
  assert.deepEqual([second[0], second[2]], ['a.png', BUDGET - fs.statSync(s.art.backdrop).size])
})

test('a buffered preview that has spent its budget stops', async () => {
  const s = await scene({ backdrop: BLUE, read: async () => ({ length: BUDGET }) })
  await assert.rejects(s.draw({ buffered: true }), {
    message: /^This preview exceeds its 256 MiB source-buffer budget\. Use smaller photo proxies\./,
  })
  assert.equal(s.seen.read.length, 1)
})
