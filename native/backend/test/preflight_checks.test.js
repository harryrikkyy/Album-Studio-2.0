'use strict'

// Every check preflightAlbum makes, one rule to a row. Each row asserts the whole list of failures,
// so a check that fires where it shouldn't is caught as surely as one that doesn't fire. Rows use a
// real PSD and JPEG unless the tree can't exist in a file (Ruling 10), or a collaborator has to lie.

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const ag = require('ag-psd')
const sharp = require('../../../src/sharp_config').getSharp()
const cache = require('../lib/cache')
const raw = require('../lib/raw')
const sheet = require('../lib/sheet')
const { preflightAlbum } = require('../lib/preflight')
const { spreadInputs } = require('../lib/inputs')
const { loadPrivate } = require('./load_private')
const { psd } = require('./psd_builder')
const { pixels, frame, fixture, codes, run } = require('./preflight_fixture')

const messages = (report) => report.errors.map((e) => e.message)
const found = (report, code) => report.info.find((e) => e.code === code)
const measured = (report) => found(report, 'effective_ppi')
const near = (value, expected) => assert.ok(Math.abs(value - expected) < 1e-9, `${value} is not ${expected}`)
const inputsOf = (f) => spreadInputs(f.album.spreads[0], f.album, f.workspace)
const given = (f, inputs, settings = {}) =>
  preflightAlbum(f.album, f.workspace, { ...f.settings, ...settings }, null, new Map([[1, inputs]]))
const secondPhoto = (f) => {
  f.album.photos.photoB = { ...f.album.photos.photoA, id: 'photoB', base: 'Second' }
  f.album.spreads[0].photoIds.push('photoB')
}
const SECOND = frame('ToolkitHFrame_002', { x: 510, y: 50, w: 200, h: 150 })

// A fresh preflight whose coverQuad notes the frames it's given: a frame's place shows nowhere in
// the report, because the photo and the coverage check both move with it.
function watched(stubs = {}) {
  const placed = []
  const coverQuad = (f, ...rest) => {
    placed.push({ x: f.x, y: f.y, w: f.w, h: f.h })
    return sheet.coverQuad(f, ...rest)
  }
  const fresh = loadPrivate('../lib/preflight.js', { stubs: { './sheet': { ...sheet, coverQuad }, ...stubs } })
  const check = (f, settings = {}) => fresh.preflightAlbum(f.album, f.workspace, { ...f.settings, ...settings })
  return { placed, check }
}
// What ag-psd would return for a tree a file can't hold. `full` is the second, pixel-reading decode.
function decoded(t, outline, full = outline) {
  t.mock.method(ag, 'readPsd', (bytes, options) => (options.skipLayerImageData ? outline : full))
}
const page = (...children) => ({ width: 800, height: 400, children })
const node = (extra) => ({ name: 'ToolkitHFrame_001', left: 100, top: 50, right: 500, bottom: 350, ...extra })

// ─── The opening checks ──────────────────────────────────────────────────────

for (const [name, selected] of [
  ['text', 'x'],
  ['an empty list', []],
  ['a repeat', [1, 1]],
  ['a fraction', [1.5]],
  ['an unknown spread', [9]],
  ['a number', 1],
]) {
  test(`a selection of ${name} is refused`, async (t) => {
    const f = await fixture(t)
    assert.deepEqual(codes(await run(f, {}, selected)), ['spread_selection_invalid'])
  })
}

for (const [name, settings] of [
  ['a resolution of 0', { ppi: 0 }],
  ['a height of 0', { heightInches: 0 }],
  ['a minimum of 0', { minEffectivePpi: 0 }],
  ['an embedding scale of 0', { embeddingScale: 0 }],
]) {
  test(`${name} stops the checks before they start`, async (t) => {
    const f = await fixture(t)
    const report = await run(f, settings)
    assert.deepEqual(messages(report), [
      'Print size, resolution and minimum effective PPI must be finite positive numbers.',
    ])
    assert.deepEqual(report.info, [])
  })
}

const SPEC = { widthInches: 2, heightInches: 1 }
for (const [name, spec, expected] of [
  ['width 0', { ...SPEC, widthInches: 0 }, ['lab_spec_invalid']],
  ['height 0', { ...SPEC, heightInches: 0 }, ['lab_spec_invalid']],
  ['a negative bleed', { ...SPEC, bleedInches: -1 }, ['lab_spec_invalid']],
  ['a negative safe area', { ...SPEC, safeInches: -1 }, ['lab_spec_invalid']],
  ['a negative gutter', { ...SPEC, gutterInches: -1 }, ['lab_spec_invalid']],
  ['no bleed', { ...SPEC, bleedInches: undefined }, []],
  ['a bleed of 0', { ...SPEC, bleedInches: 0 }, []],
  ['NaN anywhere', { ...SPEC, notes: { margin: NaN } }, ['lab_spec_invalid']],
  ['Adobe RGB', { ...SPEC, profile: 'AdobeRGB' }, ['lab_profile_unsupported']],
  ['sRGB', { ...SPEC, profile: 'sRGB' }, []],
  ['s-rgb', { ...SPEC, profile: 's-rgb' }, []],
  ['SRGB', { ...SPEC, profile: 'SRGB' }, []],
  ['no profile', SPEC, []],
  ['the right height and wrong width', { ...SPEC, widthInches: 3 }, ['lab_dimensions_mismatch']],
  ['the wrong height and right width', { ...SPEC, heightInches: 2 }, ['lab_dimensions_mismatch']],
  ['a width just within 0.001', { ...SPEC, widthInches: 2.001 }, []],
  ['a height just within 0.001', { widthInches: 2, heightInches: 1.001 }, []],
]) {
  test(`a lab spec with ${name}`, async (t) => {
    const f = await fixture(t)
    f.workspace.printSpec = spec
    const report = await run(f)
    assert.deepEqual(codes(report), expected)
    assert.deepEqual(
      report.warnings.map((e) => e.code),
      ['lab_layout_unverified'],
    )
  })
}

// 0.002 - 0.001 is exactly 0.001 in floating point, which 2.001 - 2 isn't.
for (const [name, spec] of [
  ['height', { widthInches: 0.002, heightInches: 0.002 }],
  ['width', { widthInches: 0.001, heightInches: 0.001 }],
]) {
  test(`a lab ${name} exactly 0.001 away still matches`, async (t) => {
    const f = await fixture(t)
    f.workspace.printSpec = spec
    assert.deepEqual(codes(await run(f, { heightInches: 0.001, ppi: 3000, minEffectivePpi: 1 })), [])
  })
}

test('no lab spec is a warning, not a failure', async (t) => {
  const f = await fixture(t)
  const report = await run(f)
  assert.deepEqual(codes(report), [])
  assert.deepEqual(
    report.warnings.map((e) => e.code),
    ['lab_spec_unverified'],
  )
})

test('the minimum effective PPI is reported as the rule in force', async (t) => {
  const f = await fixture(t)
  assert.equal((await run(f)).info[0].message, 'Minimum effective PPI uses the configured output resolution (300 PPI).')
  assert.equal((await run(f, { minEffectivePpi: 200 })).info[0].message, 'Minimum effective PPI explicitly set to 200.')
})

test('an empty map of inputs falls back to reading them', async (t) => {
  const f = await fixture(t)
  const report = await preflightAlbum(f.album, f.workspace, f.settings, null, new Map())
  assert.deepEqual(codes(report), [])
  assert.ok(found(report, 'verified_input_revisions'))
})

test('inputs that can’t be read stop one spread only', async (t) => {
  const f = await fixture(t)
  f.album.photos.photoA.original = f.root
  f.album.spreads.push({ n: 2, id: 'spread_2', photoIds: [], template: null })
  const report = await run(f)
  assert.deepEqual(codes(report), ['source_changed', 'template_missing'])
  assert.match(report.errors[0].message, /^Spread 1's input revisions could not be verified: /)
  assert.deepEqual(
    report.errors.map((e) => e.n),
    [1, 2],
  )
})

for (const [name, conflict, expected] of [
  ['for this spread', { n: 1 }, ['identity_conflict']],
  ['for another spread', { n: 2 }, []],
  ['for another spread, naming this photo', { n: 2, id: 'photoA' }, []],
  ['on this photo', { id: 'photoA' }, ['identity_conflict']],
  ['listing this photo', { id: 'x', candidates: ['photoA'] }, ['identity_conflict']],
  ['on this template', { id: 'templateA' }, ['identity_conflict']],
  ['listing this template', { id: 'x', candidates: ['templateA'] }, ['identity_conflict']],
  ['on neither', { id: 'x' }, []],
  ['listing neither', { id: 'x', candidates: ['y'] }, []],
]) {
  test(`a conflict ${name}`, async (t) => {
    const f = await fixture(t)
    f.album.identityConflicts = [conflict]
    assert.deepEqual(codes(await run(f)), expected)
  })
}

test('no list of conflicts means none', async (t) => {
  const f = await fixture(t)
  delete f.album.identityConflicts
  assert.deepEqual(codes(await run(f)), [])
})

test('one failure for each conflict that applies', async (t) => {
  const f = await fixture(t)
  f.album.identityConflicts = [{ n: 1 }, { id: 'photoA' }]
  const report = await run(f)
  assert.deepEqual(messages(report), [
    'Spread 1 has an ambiguous asset or adjustment. Resolve it before production.',
    'Spread 1 has an ambiguous asset or adjustment. Resolve it before production.',
  ])
})

test('a spread with no template fails only for that', async (t) => {
  const f = await fixture(t)
  f.album.spreads[0].template = null
  f.album.identityConflicts = [{ id: 'templateA' }]
  assert.deepEqual(codes(await run(f)), ['template_missing'])
})

test('two spreads on one template decode it once', async (t) => {
  const f = await fixture(t)
  f.album.spreads.push({ ...f.album.spreads[0], n: 2, id: 'spread_2' })
  const read = t.mock.method(ag, 'readPsd')
  assert.deepEqual(codes(await run(f)), [])
  assert.equal(read.mock.callCount(), 2, 'its outline, then its pixels')
})

test('a template that isn’t its verified revision is refused', async (t) => {
  const f = await fixture(t)
  const inputs = await inputsOf(f)
  inputs[1] = 'a'.repeat(64)
  const report = await given(f, inputs)
  assert.deepEqual(codes(report), ['template_corrupt'])
  assert.deepEqual(messages(report), ['Spread 1: The template changed before its verified geometry could be decoded.'])
})

const TOO_BIG = 'Spread 1: Template exceeds the full geometry-decode budget; its masks cannot be verified.'
const AT_BUDGET = { width: 15360, height: 15360 } // 15360 × 15360 × 4 is exactly 900 MiB

test('a header above the budget is refused', async (t) => {
  const f = await fixture(t)
  fs.writeFileSync(f.template, psd({ width: 16000, height: 16000, data: Buffer.alloc(2) }))
  assert.deepEqual(messages(await run(f)), [TOO_BIG])
})

for (const [name, outline] of [
  ['a layer past it', { width: 100, height: 100, children: [{ left: 0, top: 0, right: 20000, bottom: 10000 }] }],
  [
    'a nested layer past it',
    {
      width: 100,
      height: 100,
      children: [
        { left: 0, top: 0, right: 1, bottom: 1, children: [{ left: 0, top: 0, right: 20000, bottom: 10000 }] },
      ],
    },
  ],
  ['a layer of no known size', { width: 100, height: 100, children: [{}] }],
  ['one byte past it', { ...AT_BUDGET, children: [{ left: 0, top: 0, right: 1, bottom: 1 }] }],
  [
    'past it, with a layer inside out',
    {
      ...AT_BUDGET,
      children: [
        { left: 0, top: 0, right: 1, bottom: 1 },
        { left: 9, top: 0, right: 0, bottom: 9 },
      ],
    },
  ],
]) {
  test(`a template with ${name} is over the budget`, async (t) => {
    decoded(t, outline)
    const f = await fixture(t)
    assert.deepEqual(messages(await run(f)), [TOO_BIG])
  })
}

test('a template exactly at the budget goes on', async (t) => {
  decoded(t, AT_BUDGET)
  const f = await fixture(t)
  assert.deepEqual(codes(await run(f)), ['photo_unplaced'])
})

for (const [name, full] of [
  ['width 0', { width: 0, height: 400 }],
  ['height 0', { width: 800, height: 0 }],
  ['width NaN', { width: NaN, height: 400 }],
  ['height Infinity', { width: 800, height: Infinity }],
]) {
  test(`a template decoded with ${name} is refused`, async (t) => {
    decoded(t, page(), full)
    const f = await fixture(t)
    assert.deepEqual(messages(await run(f)), ['Spread 1: Invalid template dimensions.'])
  })
}

test('a canvas too big to make fails for that spread', async (t) => {
  const f = await fixture(t)
  f.album.spreads.push({ n: 2, id: 'spread_2', photoIds: [], template: null })
  const report = await run(f, { ppi: 1e7 })
  assert.deepEqual(codes(report), ['print_settings_invalid', 'template_missing'])
  assert.equal(report.errors[0].n, 1)
  assert.match(report.errors[0].message, /^This print canvas exceeds the /)
})

test('at the original size, inches come from the template and the resolution', async (t) => {
  const f = await fixture(t)
  const report = await run(f, { size: 'original' })
  assert.deepEqual(codes(report), [])
  near(measured(report).sourcePpi, 600) // 300 PPI, with the photo at half size
  near(measured(report).embeddedPpi, 375)
})

test('at the original size, the lab’s size is checked against those inches', async (t) => {
  const f = await fixture(t)
  f.workspace.printSpec = { widthInches: 800 / 300, heightInches: 400 / 300 }
  assert.deepEqual(codes(await run(f, { size: 'original' })), [])
  f.workspace.printSpec = SPEC
  assert.deepEqual(codes(await run(f, { size: 'original' })), ['lab_dimensions_mismatch'])
})

// ─── Layer edits ─────────────────────────────────────────────────────────────

const [FRAME, GROUP, PLAIN] = ['0', '1', '2']
const LAYERS = () => [
  frame(),
  { name: 'Group', children: [{ name: 'Inner', left: 1, top: 1, right: 3, bottom: 3, imageData: pixels(2, 2) }] },
  { name: 'Plain', left: 0, top: 0, right: 10, bottom: 10, imageData: pixels(10, 10) },
]
for (const [name, id, edit, expected] of [
  ['null', PLAIN, null, ['layer_edit_invalid']],
  ['text', PLAIN, 'x', ['layer_edit_invalid']],
  ['sx 0', PLAIN, { sx: 0 }, ['layer_edit_invalid']],
  ['sy -1', PLAIN, { sy: -1 }, ['layer_edit_invalid']],
  ['dx NaN', PLAIN, { dx: NaN }, ['layer_edit_invalid']],
  ['opacity 2', PLAIN, { opacity: 2 }, ['layer_edit_invalid']],
  ['opacity -1', PLAIN, { opacity: -1 }, ['layer_edit_invalid']],
  ['hidden as text', PLAIN, { hidden: 'x' }, ['layer_edit_invalid']],
  ['opacity 0', PLAIN, { opacity: 0 }, []],
  ['opacity 1', PLAIN, { opacity: 1 }, []],
  ['an unknown id', '9', {}, ['layer_geometry_unverified']],
  ['group dx 0', GROUP, { dx: 0 }, []],
  ['group dy 0', GROUP, { dy: 0 }, []],
  ['group sx 1', GROUP, { sx: 1 }, []],
  ['group sy 1', GROUP, { sy: 1 }, []],
  ['group dx 5', GROUP, { dx: 5 }, ['layer_geometry_unverified']],
  ['group dy 5', GROUP, { dy: 5 }, ['layer_geometry_unverified']],
  ['group sx 2', GROUP, { sx: 2 }, ['layer_geometry_unverified']],
  ['group sy 2', GROUP, { sy: 2 }, ['layer_geometry_unverified']],
  ['a moved plain layer', PLAIN, { dx: 5, sx: 2 }, []],
  ['a font', PLAIN, { textStyle: { font: 'x' } }, ['unsupported_edit']],
  ['a style with no font', PLAIN, { textStyle: {} }, []],
]) {
  test(`a layer edit of ${name}`, async (t) => {
    const f = await fixture(t, { frames: LAYERS() })
    f.workspace.pageLayerEdits[1] = { [id]: edit }
    assert.deepEqual(codes(await run(f)), expected)
  })
}

test('a bad edit doesn’t stop the next', async (t) => {
  const f = await fixture(t, { frames: LAYERS() })
  f.workspace.pageLayerEdits[1] = { [PLAIN]: null, 9: {} }
  assert.deepEqual(codes(await run(f)), ['layer_edit_invalid', 'layer_geometry_unverified'])
})

test('no edits for a spread, or none at all, change nothing', async (t) => {
  const f = await fixture(t)
  f.workspace.pageLayerEdits = { 2: { 9: {} } }
  assert.deepEqual(codes(await run(f)), [])
  delete f.workspace.pageLayerEdits
  assert.deepEqual(codes(await run(f)), [])
})

for (const [name, edit, place] of [
  ['right', { dx: 5 }, { x: 105, y: 50, w: 400, h: 300 }],
  ['up', { dy: -3 }, { x: 100, y: 47, w: 400, h: 300 }],
  ['wider', { sx: 2 }, { x: 100, y: 50, w: 800, h: 300 }],
  ['taller', { sy: 2 }, { x: 100, y: 50, w: 400, h: 600 }],
  ['both ways', { dx: 5, dy: -3, sx: 0.5, sy: 0.5 }, { x: 105, y: 47, w: 200, h: 150 }],
]) {
  test(`a frame moved ${name} is checked where it now is`, async (t) => {
    const f = await fixture(t)
    f.workspace.pageLayerEdits[1] = { [FRAME]: edit }
    const { placed, check } = watched()
    assert.deepEqual(codes(await check(f)), [])
    assert.deepEqual(placed, [place])
  })
}

test('a wider frame shows in the photo’s resolution', async (t) => {
  const f = await fixture(t)
  f.workspace.pageLayerEdits[1] = { [FRAME]: { sx: 2 } }
  assert.equal(measured(await run(f, { phase: 'export' })).sourcePpi, 400)
  f.workspace.pageLayerEdits[1] = { [FRAME]: { sy: 2 } }
  assert.equal(measured(await run(f, { phase: 'export' })).sourcePpi, 400)
})

for (const [name, edit, expected] of [
  ['hidden', { hidden: true }, ['frame_hidden']],
  ['half clear', { opacity: 0.5 }, []],
  ['fully clear', { opacity: 0 }, ['frame_hidden']],
]) {
  test(`a frame edited to be ${name}`, async (t) => {
    const f = await fixture(t)
    f.workspace.pageLayerEdits[1] = { [FRAME]: edit }
    assert.deepEqual(codes(await run(f)), expected)
  })
}

// ─── Frames ──────────────────────────────────────────────────────────────────

const inGroup = (extra) => [{ name: 'Group', ...extra, children: [frame()] }]
test('a frame in a hidden group is hidden', async (t) => {
  const f = await fixture(t, { frames: inGroup({ hidden: true }) })
  assert.deepEqual(codes(await run(f)), ['frame_hidden'])
})

test('showing a frame doesn’t reveal its hidden group', async (t) => {
  const f = await fixture(t, { frames: inGroup({ hidden: true }) })
  f.workspace.pageLayerEdits[1] = { '0/0': { hidden: false } }
  assert.deepEqual(codes(await run(f)), ['frame_hidden'])
})

test('a frame in a fully clear group is hidden', async (t) => {
  const f = await fixture(t, { frames: inGroup({ opacity: 0 }) })
  assert.deepEqual(codes(await run(f)), ['frame_hidden'])
})

test('opacities multiply down the tree', async (t) => {
  const f = await fixture(t, { frames: inGroup({ opacity: 0.5 }) })
  f.workspace.pageLayerEdits[1] = { '0/0': { opacity: 0 } }
  assert.deepEqual(codes(await run(f)), ['frame_hidden'])
  f.workspace.pageLayerEdits[1] = { 0: { opacity: 1 }, '0/0': { opacity: 0.5 } }
  assert.deepEqual(codes(await run(f)), [])
})

test('a frame with no stored opacity is shown', async (t) => {
  decoded(t, page(node({ imageData: pixels(400, 300) })))
  const f = await fixture(t)
  assert.deepEqual(codes(await run(f)), [])
})

const SOLID = () => pixels(400, 300)
const GONE = "Spread 1's frame pixels and mask cannot be verified."
for (const [name, extra] of [
  ['no pixels and no mask', {}],
  ['a disabled mask', { mask: { disabled: true, left: 100, top: 50, right: 500, bottom: 350, imageData: SOLID() } }],
  ['a mask with no pixels', { mask: { left: 100, top: 50, right: 500, bottom: 350 } }],
]) {
  test(`a frame with ${name} can’t be measured`, async (t) => {
    decoded(t, page(node(extra)))
    const f = await fixture(t)
    assert.deepEqual(messages(await run(f)), [GONE])
  })
}

test('a fill layer whose mask is off can’t be measured', async (t) => {
  const mask = { disabled: true, left: 100, top: 50, right: 500, bottom: 350, imageData: SOLID() }
  decoded(t, page(node({ left: 300, right: 300, mask })))
  const f = await fixture(t)
  assert.deepEqual(messages(await run(f)), [GONE])
})

const coverage = (width, height, value = 255) => {
  const image = pixels(width, height)
  image.data.fill(value)
  return image
}
// A layer of 400 × 300 at (100, 50), and the area left of it once its mask is applied.
const FILL = { left: 100, top: 50, right: 500, bottom: 350 }
for (const [name, extra, place] of [
  [
    'a fill layer with no width, away from its mask',
    { left: 300, right: 300, mask: { ...FILL, imageData: coverage(400, 300) } },
    { x: 100, y: 50, w: 400, h: 300 },
  ],
  [
    'a fill layer with no height, away from its mask',
    { top: 200, bottom: 200, mask: { ...FILL, imageData: coverage(400, 300) } },
    { x: 100, y: 50, w: 400, h: 300 },
  ],
  [
    'a fill layer open outside its mask’s pixels',
    { right: 100, mask: { ...FILL, defaultColor: 255, imageData: coverage(400, 300) } },
    { x: 100, y: 50, w: 400, h: 300 },
  ],
  [
    'a mask shut everywhere but the row below its pixels',
    { imageData: SOLID(), mask: { left: 100, top: 50, defaultColor: 255, imageData: coverage(400, 299, 0) } },
    { x: 100, y: 349, w: 400, h: 1 },
  ],
  [
    'pixels and a mask with none',
    { imageData: SOLID(), mask: { left: 150, top: 100, right: 250, bottom: 200 } },
    { x: 100, y: 50, w: 400, h: 300 },
  ],
  [
    'a fill layer with no width',
    { right: 100, mask: { left: 100, top: 50, right: 500, bottom: 350, imageData: coverage(400, 300) } },
    { x: 100, y: 50, w: 400, h: 300 },
  ],
  [
    'a fill layer with no height',
    { bottom: 50, mask: { left: 100, top: 50, right: 500, bottom: 350, imageData: coverage(400, 300) } },
    { x: 100, y: 50, w: 400, h: 300 },
  ],
  [
    'a mask placed against the layer',
    { imageData: SOLID(), mask: { left: 20, top: 10, positionRelativeToLayer: true, imageData: coverage(100, 50) } },
    { x: 120, y: 60, w: 100, h: 50 },
  ],
  [
    'a mask placed against the page',
    { imageData: SOLID(), mask: { left: 120, top: 60, positionRelativeToLayer: false, imageData: coverage(100, 50) } },
    { x: 120, y: 60, w: 100, h: 50 },
  ],
  [
    'a mask with no corner',
    { imageData: SOLID(), mask: { imageData: coverage(150, 100) } },
    { x: 100, y: 50, w: 50, h: 50 },
  ],
  [
    'a mask open outside its pixels',
    { imageData: SOLID(), mask: { left: 100, top: 50, defaultColor: 255, imageData: coverage(100, 50, 0) } },
    { x: 100, y: 50, w: 400, h: 300 },
  ],
  [
    'a mask closed outside its pixels',
    { imageData: SOLID(), mask: { left: 200, top: 100, imageData: coverage(100, 100) } },
    { x: 200, y: 100, w: 100, h: 100 },
  ],
]) {
  test(`a frame with ${name}`, async (t) => {
    decoded(t, page(node(extra)))
    const f = await fixture(t)
    const { placed, check } = watched()
    assert.deepEqual(codes(await check(f)), [])
    assert.deepEqual(placed, [place])
  })
}

test('a mask open to the layer’s edge only keeps the frame’s other edges', async (t) => {
  // The mask is shut at 100 × 50 in the corner and over the first column of the rest.
  const mask = { left: 100, top: 50, imageData: coverage(400, 300) }
  mask.imageData.data.fill(0, 0, 400 * 4)
  decoded(t, page(node({ imageData: SOLID(), mask })))
  const f = await fixture(t)
  const { placed, check } = watched()
  await check(f)
  assert.deepEqual(placed, [{ x: 100, y: 51, w: 400, h: 299 }])
})

test('a frame with nothing showing is empty, and still gets its photo’s checks', async (t) => {
  const f = await fixture(t, { frames: [frame(undefined, { imageData: pixels(400, 300, 0) })] })
  const report = await run(f)
  assert.deepEqual(codes(report), ['frame_empty'])
  assert.ok(measured(report))
})

const onePixel = (x, y) => {
  const image = pixels(400, 300, 0)
  image.data[(y * 400 + x) * 4 + 3] = 255
  return image
}
for (const [name, x, y, place] of [
  ['top left', 0, 0, { x: 100, y: 50, w: 1, h: 1 }],
  ['top right', 399, 0, { x: 499, y: 50, w: 1, h: 1 }],
  ['bottom left', 0, 299, { x: 100, y: 349, w: 1, h: 1 }],
  ['bottom right', 399, 299, { x: 499, y: 349, w: 1, h: 1 }],
]) {
  test(`one opaque pixel at the ${name} is the whole frame`, async (t) => {
    decoded(t, page(node({ imageData: onePixel(x, y) })))
    const f = await fixture(t)
    const { placed, check } = watched()
    assert.deepEqual(codes(await check(f)), [])
    assert.deepEqual(placed, [place])
  })
}

test('an edited frame scales its opaque area with it', async (t) => {
  decoded(t, page(node({ imageData: onePixel(10, 20) })))
  const f = await fixture(t)
  f.workspace.pageLayerEdits[1] = { [FRAME]: { sx: 2, sy: 3, dx: 1, dy: 1 } }
  const { placed, check } = watched()
  await check(f)
  assert.deepEqual(placed, [{ x: 121, y: 111, w: 2, h: 3 }])
})

// ─── Photos ──────────────────────────────────────────────────────────────────

test('more photos than frames', async (t) => {
  const f = await fixture(t)
  secondPhoto(f)
  assert.deepEqual(codes(await run(f)), ['photo_unplaced'])
})

test('fewer photos than frames', async (t) => {
  const f = await fixture(t)
  f.album.spreads[0].photoIds = []
  assert.deepEqual(codes(await run(f)), ['frame_unfilled'])
})

test('a photo with no orientation counts as horizontal', async (t) => {
  const f = await fixture(t)
  delete f.album.photos.photoA.orient
  assert.deepEqual(codes(await run(f)), [])
})

test('photos fill frames in name order', async (t) => {
  const f = await fixture(t, { frames: [SECOND, frame()] })
  secondPhoto(f)
  const { placed, check } = watched()
  assert.deepEqual(codes(await check(f)), [])
  assert.deepEqual(placed, [
    { x: 100, y: 50, w: 400, h: 300 },
    { x: 510, y: 50, w: 200, h: 150 },
  ])
})

test('a photo with no name is called by its id', async (t) => {
  const f = await fixture(t)
  delete f.album.photos.photoA.base
  const report = await run(f, { heightInches: 3 })
  assert.equal(measured(report).message, 'photoA: 266.7 effective PPI.')
  assert.deepEqual(messages(report), ['Spread 1: photoA is below the 300 PPI policy (266.7).'])
  f.album.photos.photoA.original = null
  assert.deepEqual(messages(await run(f)), ['Spread 1: original for photoA is missing; thumbnails cannot be printed.'])
})

test('an undecodable photo with no name is called by its id', async (t) => {
  const f = await fixture(t)
  delete f.album.photos.photoA.base
  fs.writeFileSync(f.original, 'not a photo')
  const [message] = messages(await run(f))
  assert.match(message, /^Spread 1: photoA cannot be fully decoded \(/)
})

test('a missing original doesn’t stop the next photo’s checks', async (t) => {
  const f = await fixture(t, { frames: [frame(), SECOND] })
  secondPhoto(f)
  f.album.photos.photoA.original = path.join(f.root, 'gone.jpg')
  const report = await run(f)
  assert.deepEqual(codes(report), ['missing_original', 'source_changed'])
  assert.equal(measured(report).photoId, 'photoB')
})

for (const [name, rotation] of [
  ['text', 'x'],
  ['NaN', NaN],
]) {
  test(`a rotation of ${name} is refused`, async (t) => {
    const f = await fixture(t)
    f.workspace.imageRotations.photoA = rotation
    assert.deepEqual(codes(await run(f)), ['photo_edit_invalid'])
  })
}

for (const [name, placement, expected] of [
  ['a zoom below 1', { scale: 0.5 }, ['photo_edit_invalid']],
  ['a zoom as text', { scale: 'x' }, ['photo_edit_invalid']],
  ['an x offset past the edge', { ox: 2 }, ['photo_edit_invalid']],
  ['a y offset past the edge', { oy: -2 }, ['photo_edit_invalid']],
  ['an x offset as text', { ox: 'x' }, ['photo_edit_invalid']],
  ['a y offset as text', { oy: 'x' }, ['photo_edit_invalid']],
  ['the largest offsets', { ox: 1, oy: -1 }, []],
  ['a zoom of 1', { scale: 1 }, []],
]) {
  test(`a placement with ${name}`, async (t) => {
    const f = await fixture(t)
    f.workspace.imagePlacements.photoA = placement
    assert.deepEqual(codes(await run(f)), expected)
  })
}

const SLIDERS = [
  'exposure',
  'contrast',
  'saturation',
  'warmth',
  'tint',
  'fade',
  'clarity',
  'sharpen',
  'blur',
  'vignette',
]
for (const slider of SLIDERS) {
  test(`${slider} past 100 is refused`, async (t) => {
    const f = await fixture(t)
    f.workspace.imageAdjustments.photoA = { [slider]: 101 }
    assert.deepEqual(codes(await run(f)), ['photo_edit_invalid'])
  })
}

for (const [name, adjust, expected] of [
  ['exposure below -100', { exposure: -101 }, ['photo_edit_invalid']],
  ['exposure as text', { exposure: 'x' }, ['photo_edit_invalid']],
  ['black and white as text', { bw: 'x' }, ['photo_edit_invalid']],
  ['exposure at 100', { exposure: 100 }, []],
  ['exposure at -100', { exposure: -100 }, []],
  ['black and white', { bw: true }, []],
  ['curves', { curves: true }, ['unsupported_edit']],
  ['curves switched off', { curves: false }, []],
  ['a vignette', { vignette: 10 }, ['unsupported_edit']],
  ['no vignette', { vignette: 0 }, []],
]) {
  test(`an adjustment of ${name}`, async (t) => {
    const f = await fixture(t)
    f.workspace.imageAdjustments.photoA = adjust
    assert.deepEqual(codes(await run(f)), expected)
  })
}

test('a vignette with curves fails for both', async (t) => {
  const f = await fixture(t)
  f.workspace.imageAdjustments.photoA = { vignette: 10, curves: true }
  assert.deepEqual(messages(await run(f)), [
    'Spread 1 has a colour adjustment that the print renderer does not support.',
    "Spread 1's vignette is preview-only and must be removed before printing.",
  ])
})

for (const [name, change] of [
  ['no entry for the photo', (inputs) => (inputs[2] = [])],
  ['another file', (inputs, f) => (inputs[2][0][1] = f.thumb)],
]) {
  test(`verified inputs with ${name} are refused`, async (t) => {
    const f = await fixture(t)
    const inputs = await inputsOf(f)
    change(inputs, f)
    assert.equal(
      messages(await given(f, inputs))[0],
      'Spread 1: Original cannot be fully decoded (The original no longer matches its verified print input.).',
    )
  })
}

test('a photo that isn’t its verified revision is refused', async (t) => {
  const f = await fixture(t)
  const inputs = await inputsOf(f)
  inputs[2][0][2] = 'a'.repeat(64)
  const report = await given(f, inputs)
  assert.deepEqual(codes(report), ['photo_corrupt', 'source_changed'])
  assert.equal(
    report.errors[0].message,
    'Spread 1: Original cannot be fully decoded (The original changed before its print metadata could be verified.).',
  )
  assert.equal(report.errors[1].message, "Spread 1's print inputs changed during verification: photo photoA changed")
})

for (const [name, token, folder] of [
  ['the output folder', (f) => f.workspace.outputToken, (f) => path.join(f.root, 'output')],
  ['the album’s exports folder', () => undefined, (f) => path.join(f.root, 'exports')],
]) {
  test(`developed RAW files go under ${name}`, async (t) => {
    const f = await fixture(t)
    f.workspace.outputToken = token(f)
    const asked = []
    const placeableEvidence = (file, dir) => {
      asked.push(dir)
      return raw.placeableEvidence(file, dir)
    }
    const { check } = watched({ './raw': { ...raw, placeableEvidence } })
    await check(f)
    assert.deepEqual(asked, [path.join(folder(f), '.album-studio', 'raw')])
  })
}

for (const [orientation, sourcePpi] of [
  [1, 800],
  [5, 600],
  [6, 600],
  [7, 600],
  [8, 600],
]) {
  test(`a photo stored with orientation ${orientation} is measured upright`, async (t) => {
    const f = await fixture(t)
    await sharp(fs.readFileSync(f.original)).withMetadata({ orientation }).jpeg().toFile(`${f.original}.new`)
    fs.renameSync(`${f.original}.new`, f.original)
    assert.equal(measured(await run(f, { phase: 'export' })).sourcePpi, sourcePpi)
  })
}

const reading = (metadata, count = () => {}) => ({
  getSharp: () => () => ({
    metadata: async () => (count(), metadata),
    stats: async () => ({}),
  }),
})
for (const [name, metadata] of [
  ['no width', { width: 0, height: 600 }],
  ['a width of NaN', { width: NaN, height: 600 }],
  ['a height of NaN', { width: 800, height: NaN }],
]) {
  test(`a photo that decodes to ${name} is refused`, async (t) => {
    const f = await fixture(t)
    const { check } = watched({ '../../../src/sharp_config': reading(metadata) })
    assert.deepEqual(messages(await check(f)), [
      'Spread 1: Original cannot be fully decoded (Invalid source dimensions.).',
    ])
  })
}

test('two photos of one file are decoded once', async (t) => {
  const f = await fixture(t, { frames: [frame(), SECOND] })
  secondPhoto(f)
  let reads = 0
  const { check } = watched({
    '../../../src/sharp_config': reading({ width: 800, height: 600 }, () => reads++),
  })
  assert.deepEqual(codes(await check(f)), [])
  assert.equal(reads, 1)
})

test('at export, only the source resolution is claimed, and the report says so', async (t) => {
  const f = await fixture(t)
  const report = await run(f, { phase: 'export' })
  const { sourcePpi, embeddedPpi, effectivePpi } = measured(report)
  assert.deepEqual([sourcePpi, embeddedPpi, effectivePpi], [800, null, 800])
  assert.deepEqual(
    report.warnings.map((e) => e.code),
    ['lab_spec_unverified', 'embedded_resolution_unverified'],
  )
})

test('at render, the embedded resolution is measured too', async (t) => {
  const f = await fixture(t)
  const report = await run(f)
  const { sourcePpi, embeddedPpi, effectivePpi } = measured(report)
  assert.deepEqual([sourcePpi, embeddedPpi, effectivePpi], [800, 375, 375])
  assert.deepEqual(
    report.warnings.map((e) => e.code),
    ['lab_spec_unverified'],
  )
})

test('a given embedding scale replaces the canvas’s', async (t) => {
  const f = await fixture(t)
  assert.equal(measured(await run(f, { embeddingScale: 1 })).embeddedPpi, 500)
})

for (const [name, minimum, expected] of [
  ['exactly at it', 375, []],
  ['within the tolerance', 375 + 5e-8, []],
  ['exactly the tolerance away', 375 + 1e-7, []],
  ['just above it', 375 + 2e-7, ['low_effective_ppi']],
]) {
  test(`a photo measuring 375 with the minimum ${name}`, async (t) => {
    const f = await fixture(t)
    assert.deepEqual(codes(await run(f, { minEffectivePpi: minimum })), expected)
  })
}

test('a turned photo that leaves a corner showing is refused', async (t) => {
  const f = await fixture(t)
  f.workspace.imageRotations.photoA = 45
  assert.deepEqual(messages(await run(f)), ["Spread 1's rotated photo does not cover all frame corners."])
})

for (const [name, placement, rotation] of [
  ['zoomed to cover', { scale: 3 }, 45],
  ['turned a quarter', {}, 90],
  ['upside down', {}, 180],
  ['turned the other way', { scale: 3 }, -45],
]) {
  test(`a turned photo ${name} covers its frame`, async (t) => {
    const f = await fixture(t)
    f.workspace.imageRotations.photoA = rotation
    f.workspace.imagePlacements.photoA = placement
    assert.deepEqual(codes(await run(f)), [])
  })
}

// The photo is 800 × 600 at half size, so its half widths with the 0.01 allowed are these. At (0, 0)
// a corner's distance from the centre is the centre itself, with no rounding to spoil the match.
for (const [name, cx, cy] of [
  ['across', 200.01, 0],
  ['down', 0, 150.01],
]) {
  test(`a corner exactly the tolerance outside the photo ${name} counts as covered`, async (t) => {
    const f = await fixture(t, { frames: [frame(undefined, { x: 0, y: 0, w: 10, h: 10 })] })
    const quad = [
      [0, 0],
      [0, 0],
      [cx * 2, cy * 2],
      [0, 0],
    ]
    const stubs = { './sheet': { ...sheet, coverQuad: () => ({ quad, scale: 0.5 }) } }
    const fresh = loadPrivate('../lib/preflight.js', { stubs })
    const settings = { ...f.settings, phase: 'export' }
    assert.deepEqual(codes(await fresh.preflightAlbum(f.album, f.workspace, settings)), [])
  })
}

test('each photo the album doesn’t have is reported, and nothing else stops', async (t) => {
  const f = await fixture(t)
  f.album.spreads[0].photoIds.push('ghostA', 'ghostB')
  const report = await run(f)
  assert.deepEqual(messages(report), [
    'Spread 1 references a missing photo (ghostA).',
    'Spread 1 references a missing photo (ghostB).',
  ])
  assert.deepEqual(
    found(report, 'verified_input_revisions').photos.map(({ id }) => id),
    ['photoA', 'ghostA', 'ghostB'],
  )
})

for (const [name, file, message] of [
  ['the template', (f) => f.template, 'the template changed'],
  ['a photo', (f) => f.original, 'photo photoA changed'],
]) {
  test(`${name} changing during the checks is caught`, async (t) => {
    const f = await fixture(t)
    const fileDigest = async (asked) => (asked === file(f) ? 'changed' : cache.fileDigest(asked))
    const { check } = watched({ './cache': { ...cache, fileDigest } })
    const report = await check(f)
    assert.deepEqual(messages(report), [`Spread 1's print inputs changed during verification: ${message}`])
    assert.equal(found(report, 'verified_input_revisions'), undefined)
  })
}

test('the verified revisions are the files’ own digests', async (t) => {
  const f = await fixture(t)
  const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  const { n, id, templateDigest, photos } = found(await run(f), 'verified_input_revisions')
  assert.deepEqual([n, id], [1, 'spread_1'])
  assert.equal(templateDigest, sha(f.template))
  assert.deepEqual(photos, [{ id: 'photoA', digest: sha(f.original) }])
})

test('one album breaking many rules reports them in order', async (t) => {
  const f = await fixture(t, { frames: [frame(), SECOND] })
  secondPhoto(f)
  delete f.album.photos.photoB.base
  f.album.photos.photoC = { ...f.album.photos.photoA, id: 'photoC', orient: 'v' }
  f.album.spreads[0].photoIds.push('photoC', 'ghost')
  f.album.identityConflicts = [{ n: 1 }]
  f.album.spreads.push({ n: 2, id: 'spread_2', photoIds: [], template: null })
  f.workspace.printSpec = { widthInches: 3, heightInches: 1, profile: 'AdobeRGB' }
  f.workspace.pageLayerEdits[1] = { 0: { hidden: true }, 5: {}, 9: null }
  f.workspace.imageAdjustments.photoA = { vignette: 10 }
  f.workspace.imageRotations.photoA = 45
  f.workspace.imagePlacements.photoB = { scale: 0.5 }
  const fileDigest = async (asked) => (asked === f.template ? 'changed' : cache.fileDigest(asked))
  const { check } = watched({ './cache': { ...cache, fileDigest } })
  const report = await check(f, { phase: 'export' })
  assert.deepEqual(
    report.errors.map(({ n, code }) => [n, code]),
    [
      [undefined, 'lab_profile_unsupported'],
      [1, 'identity_conflict'],
      [1, 'lab_dimensions_mismatch'],
      [1, 'layer_geometry_unverified'],
      [1, 'layer_edit_invalid'],
      [1, 'frame_hidden'],
      [1, 'unsupported_edit'],
      [1, 'frame_coverage'],
      [1, 'photo_edit_invalid'],
      [1, 'photo_unplaced'],
      [1, 'photo_missing'],
      [1, 'source_changed'],
      [2, 'template_missing'],
    ],
  )
  assert.deepEqual(
    report.warnings.map(({ code }) => code),
    ['lab_layout_unverified', 'embedded_resolution_unverified'],
  )
  assert.deepEqual(
    report.info.map(({ code, photoId }) => [code, photoId]),
    [
      ['effective_ppi_policy', undefined],
      ['effective_ppi', 'photoA'],
    ],
  )
})

// ─── Two rules at once ───────────────────────────────

// Each album breaks two rules, so swapping the two checks changes the list or its message.

test('a frame with no photo is named ahead of a photo below the policy', async (t) => {
  const f = await fixture(t, { frames: [frame(), SECOND] })
  assert.deepEqual(codes(await run(f, { minEffectivePpi: 100000 })), ['frame_unfilled', 'low_effective_ppi'])
})

test('a low resolution is named ahead of a rotated photo that falls short', async (t) => {
  const f = await fixture(t)
  f.workspace.imageRotations.photoA = 45
  assert.deepEqual(codes(await run(f, { minEffectivePpi: 100000 })), ['low_effective_ppi', 'frame_coverage'])
})

test('a moved group is named ahead of a font change on it', async (t) => {
  const inner = { name: 'Inner', left: 10, top: 10, right: 20, bottom: 20, imageData: pixels(10, 10) }
  const group = { name: 'Group', left: 10, top: 10, right: 20, bottom: 20, children: [inner] }
  const f = await fixture(t, { frames: [frame(), group] })
  f.workspace.pageLayerEdits[1] = { 1: { dx: 5, textStyle: { font: 'Arial' } } }
  assert.deepEqual(codes(await run(f)), ['layer_geometry_unverified', 'unsupported_edit'])
})

test('inputs that can’t be read end the spread ahead of an identity conflict', async (t) => {
  const f = await fixture(t)
  f.album.identityConflicts = [{ n: 1 }]
  f.album.photos.photoA.original = f.root
  assert.deepEqual(codes(await run(f)), ['source_changed'])
})

test('an identity conflict is named ahead of a missing template', async (t) => {
  const f = await fixture(t)
  const inputs = await inputsOf(f)
  f.album.identityConflicts = [{ n: 1 }]
  fs.rmSync(f.template)
  assert.deepEqual(codes(await given(f, inputs)), ['identity_conflict', 'template_missing'])
})

test('a print size that can’t be made ends the spread ahead of the lab’s dimensions', async (t) => {
  const f = await fixture(t)
  f.workspace.printSpec = { widthInches: 3, heightInches: 1, profile: 'sRGB' }
  assert.deepEqual(codes(await run(f, { heightInches: 100000 })), ['print_settings_invalid'])
})

test('a changed template is reported as changed, not as unreadable', async (t) => {
  const f = await fixture(t)
  const inputs = await inputsOf(f)
  fs.writeFileSync(f.template, 'not a psd at all, and not what was digested')
  assert.deepEqual(messages(await given(f, inputs)), [
    'Spread 1: The template changed before its verified geometry could be decoded.',
  ])
})

test('a template changed during the checks is named ahead of a changed photo', async (t) => {
  const { check } = watched({ './cache': { ...cache, fileDigest: async () => 'changed' } })
  const f = await fixture(t)
  assert.deepEqual(messages(await check(f)), [
    "Spread 1's print inputs changed during verification: the template changed",
  ])
})

test('a changed original is named ahead of a developed file that can’t be read', async (t) => {
  const placeableEvidence = async () => ({ file: '/gone.jpg', digest: 'x', sourceKey: 'another revision' })
  const { check } = watched({ './raw': { ...raw, placeableEvidence } })
  const f = await fixture(t)
  assert.deepEqual(messages(await check(f)), [
    'Spread 1: Original cannot be fully decoded (The original changed before its print metadata could be verified.).',
  ])
})

test('an adjustment the printer can’t make is named ahead of a corrupt photo', async (t) => {
  const f = await fixture(t)
  f.workspace.imageAdjustments.photoA = { curves: true }
  fs.writeFileSync(f.album.photos.photoA.original, Buffer.alloc(100))
  assert.deepEqual(codes(await run(f)), ['unsupported_edit', 'photo_corrupt'])
})

// ─── Names in the messages ──────────────────────────────

test('a photo below the policy goes by its name', async (t) => {
  const f = await fixture(t)
  f.album.photos.photoA.base = 'Kept name'
  const report = await run(f, { minEffectivePpi: 100000 })
  assert.deepEqual(messages(report), ['Spread 1: Kept name is below the 100000 PPI policy (375.0).'])
  assert.equal(measured(report).message, 'Kept name: 375.0 effective PPI.')
})

test('a missing original goes by its photo’s name', async (t) => {
  const f = await fixture(t)
  f.album.photos.photoA.base = 'Kept name'
  const inputs = await inputsOf(f)
  fs.rmSync(f.album.photos.photoA.original)
  assert.equal(
    messages(await given(f, inputs))[0],
    'Spread 1: original for Kept name is missing; thumbnails cannot be printed.',
  )
})
