'use strict'

// What each of the editor's layer overrides and page overlays asks of the engine, in order. The
// template outline comes from a real PSD; the engine is a fake that records every call and can fail
// any of them, because a failed step must only ever cost its own warning. Each command takes a turn
// to answer, as the real engine's do, so a step that isn't waited for reports too late.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ag = require('ag-psd')
const { tmpdir } = require('./fixtures')
const { loadPrivate } = require('./load_private')
const { psd } = require('./psd_builder')

function fakePc({ doc, fail = {}, answers = {} }) {
  const calls = []
  const act = async (op, params) => {
    calls.push([op, params])
    await new Promise(setImmediate)
    if (fail[op]) throw fail[op] === true ? new Error(`${op} failed`) : fail[op]
    return answers[op] ?? {}
  }
  return {
    calls,
    call: async (op, params) => {
      if (op !== 'doc.inspect') return act(op, params)
      calls.push([op, params])
      await new Promise(setImmediate)
      return doc
    },
    run: act,
  }
}

// ─── applyLayerEdits ─────────────────────────────────────────────────────────

const pixels = (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4).fill(200) })
// In the PSD's own bottom-to-top order, which is how the editor numbers them.
const LAYERS = [
  { name: 'Background', left: 0, top: 0, right: 40, bottom: 30, imageData: pixels(40, 30) },
  {
    name: 'Title',
    left: 2,
    top: 2,
    right: 20,
    bottom: 12,
    hidden: true,
    opacity: 0.5,
    imageData: pixels(18, 10),
    text: { text: 'Hello', transform: [1, 0, 0, 1, 3, 4], style: { font: { name: 'ArialMT' }, fontSize: 12 } },
  },
  { name: 'Group', children: [{ name: 'Inner', left: 1, top: 1, right: 3, bottom: 3, imageData: pixels(2, 2) }] },
]
const folder = tmpdir()
test.after(() => fs.rmSync(folder, { recursive: true, force: true }))
const TEMPLATE = path.join(folder, 'template.psd')
const EMPTY = path.join(folder, 'empty.psd')
fs.writeFileSync(
  TEMPLATE,
  Buffer.from(ag.writePsdBuffer({ width: 40, height: 30, imageData: pixels(40, 30), children: LAYERS })),
)
fs.writeFileSync(EMPTY, psd())

// The engine lists the same layers top to bottom.
const BACKGROUND = { id: 10, name: 'Background' }
const TITLE = { id: 11, name: 'Title', bounds: [2, 2, 18, 10] }
const INNER = { id: 13, name: 'Inner' }
const ENGINE = { resolution: 300, layers: [{ id: 12, name: 'Group', layers: [INNER] }, TITLE, BACKGROUND] }

const { applyLayerEdits, addOverlays } = (() => {
  const stubs = {
    '../../../src/overlay_render': { resolveTextLayout: (...args) => scene.layout(...args) },
    '../../../src/overlay_ps': { hasShapeOverlays: (overlays) => scene.shapes(overlays) },
    '../../../src/proof_renderer': { rasterizeOverlays: (...args) => scene.png(...args) },
  }
  return loadPrivate('../lib/parity.js', { stubs })
})()

async function edited(layerEdits, options = {}) {
  const pc = fakePc({ doc: ENGINE, ...options })
  const warnings = await applyLayerEdits(pc, options.template ?? TEMPLATE, layerEdits)
  return { warnings, calls: pc.calls.filter(([op]) => op !== 'doc.inspect'), all: pc.calls }
}
const visible = (layer, value) => ['layer.setProps', { layer, visible: value }]
const opacity = (layer, value) => ['layer.setProps', { layer, opacity: value }]
const translate = (layer, dx, dy) => ['layer.translate', { layer, dx, dy }]

for (const [name, edits] of [
  ['null', null],
  ['undefined', undefined],
  ['no edits', {}],
]) {
  test(`${name} asks nothing of the engine or the file`, async () => {
    const pc = fakePc({ doc: ENGINE })
    assert.deepEqual(await applyLayerEdits(pc, path.join(folder, 'not-there.psd'), edits), [])
    assert.deepEqual(pc.calls, [])
  })
}

for (const [name, resolution, size] of [
  ['the document’s resolution', 300, 24],
  ['72 when the resolution is 0', 0, 100],
  ['72 when the resolution is missing', undefined, 100],
  ['72 when the resolution is text', 'high', 100],
]) {
  test(`type sizes use ${name}`, async () => {
    const doc = { ...ENGINE, resolution }
    const { calls } = await edited({ 1: { textStyle: { sizePx: 100 } } }, { doc })
    assert.deepEqual(calls, [['type.setStyle', { layer: 11, size }]])
  })
}

test('an edit for a template with no layers is reported with its id', async () => {
  const { warnings, calls } = await edited({ 0: {} }, { template: EMPTY })
  assert.deepEqual(warnings, [
    "a template layer edited in the spread editor (0) wasn't found in the template; that edit was left out",
  ])
  assert.deepEqual(calls, [])
})

test('an edit for a layer the template has but the engine doesn’t is reported by name', async () => {
  const { warnings } = await edited({ 0: { hidden: true } }, { doc: { layers: [{ id: 1, name: 'Other' }] } })
  assert.deepEqual(warnings, [
    "a template layer edited in the spread editor (“Background”) wasn't found in the template; that edit was left out",
  ])
})

test('a layer that’s missing doesn’t stop the next edit', async () => {
  const { warnings, calls } = await edited({ 0: { hidden: true }, 9: { hidden: true } })
  assert.equal(warnings.length, 1)
  assert.deepEqual(calls, [visible(10, false)])
})

test('nested layers are found by their path', async () => {
  const { calls } = await edited({ '2/0': { hidden: true } })
  assert.deepEqual(calls, [visible(13, false)])
})

for (const [name, edit, expected] of [
  ['hidden, as the template already has it', { 0: { hidden: false } }, []],
  ['hidden on a hidden layer', { 1: { hidden: true } }, []],
  ['hiding a shown layer', { 0: { hidden: true } }, [visible(10, false)]],
  ['showing a hidden layer', { 1: { hidden: false } }, [visible(11, true)]],
  ['opacity within 0.001', { 0: { opacity: 0.9995 } }, []],
  ['opacity beyond 0.001', { 0: { opacity: 0.99 } }, [opacity(10, 0.99)]],
  ['opacity of 0', { 0: { opacity: 0 } }, [opacity(10, 0)]],
  ['the layer’s own opacity', { 1: { opacity: 128 / 255 } }, []],
  ['opacity against the layer’s own', { 1: { opacity: 1 } }, [opacity(11, 1)]],
  ['the same text', { 1: { text: 'Hello' } }, []],
  ['new text', { 1: { text: 'Hi' } }, [['type.edit', { layer: 11, text: 'Hi' }]]],
  [
    'new text, with its line ends tidied',
    { 1: { text: 'a\r\nb\rc\nd' } },
    [['type.edit', { layer: 11, text: 'a\nb\nc\nd' }]],
  ],
  ['text for a layer that has none', { 0: { text: 'Hi' } }, []],
  ['text that isn’t a string', { 1: { text: 5 } }, []],
  ['a style on a layer with no text', { 0: { textStyle: { sizePx: 24, font: 'X' } } }, []],
  ['a size of 0', { 1: { textStyle: { sizePx: 0 } } }, []],
  ['a size', { 1: { textStyle: { sizePx: 24 } } }, [['type.setStyle', { layer: 11, size: 5.76 }]]],
  ['a size that rounds', { 1: { textStyle: { sizePx: 7 } } }, [['type.setStyle', { layer: 11, size: 1.68 }]]],
  ['a colour', { 1: { textStyle: { color: '#112233' } } }, [['type.setStyle', { layer: 11, color: '#112233' }]]],
  [
    'a capital colour',
    { 1: { textStyle: { color: '#ABCDEF' } } },
    [['type.setStyle', { layer: 11, color: '#ABCDEF' }]],
  ],
  ['a colour name', { 1: { textStyle: { color: 'red' } } }, []],
  ['a colour with a prefix', { 1: { textStyle: { color: 'x#112233' } } }, []],
  ['a colour with a suffix', { 1: { textStyle: { color: '#112233ff' } } }, []],
  ['a colour that’s a number', { 1: { textStyle: { color: 0x112233 } } }, []],
  [
    'a size and colour',
    { 1: { textStyle: { sizePx: 24, color: '#112233' } } },
    [['type.setStyle', { layer: 11, size: 5.76, color: '#112233' }]],
  ],
  ['no change of place', { 0: { sx: 1, sy: 1, dx: 0, dy: 0 } }, []],
  ['a move that isn’t a number', { 0: { dx: 'left', dy: null } }, []],
  ['a move as text', { 0: { dx: '2.6' } }, [translate(10, 3, 0)]],
  ['a move down', { 0: { dy: 4 } }, [translate(10, 0, 4)]],
  ['a move in fractions', { 0: { dx: 1.5, dy: -2.4 } }, [translate(10, 2, -2)]],
  ['a move with a text scale, read as 1', { 0: { sx: '2', sy: null, dx: 1 } }, [translate(10, 1, 0)]],
]) {
  test(`applyLayerEdits, ${name}`, async () => {
    const { warnings, calls } = await edited(edit)
    assert.deepEqual(calls, expected)
    assert.deepEqual(warnings, [])
  })
}

const FONT = "“Title”: the font chosen in the spread editor isn't applied yet; the template's own font was kept"

test('a font can’t be applied yet, and says so after any restyle', async () => {
  const edit = { 1: { textStyle: { font: 'Inter', sizePx: 24 } } }
  const { warnings, calls } = await edited(edit)
  assert.deepEqual(warnings, [FONT])
  assert.equal(calls.length, 1)
  const failed = await edited(edit, { fail: { 'type.setStyle': true } })
  assert.deepEqual(failed.warnings, ["“Title”: couldn't restyle it (type.setStyle failed)", FONT])
})

const rect = (x0, y0, x1, y1) => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
]

for (const [name, edit, transform] of [
  ['a stretch across', { 0: { sx: 2 } }, { layer: 10, rect: [0, 0, 40, 30], quad: rect(0, 0, 80, 30) }],
  ['a stretch down', { 0: { sy: 0.5 } }, { layer: 10, rect: [0, 0, 40, 30], quad: rect(0, 0, 40, 15) }],
  [
    'a stretch and a move',
    { 0: { sx: 2, sy: 0.5, dx: 3.5, dy: 1 } },
    { layer: 10, rect: [0, 0, 40, 30], quad: rect(3.5, 1, 83.5, 16) },
  ],
  ['the layer’s nested box', { '2/0': { sx: 3 } }, { layer: 13, rect: [1, 1, 3, 3], quad: rect(1, 1, 7, 3) }],
]) {
  test(`applyLayerEdits, ${name}`, async () => {
    const { calls } = await edited(edit)
    assert.deepEqual(calls, [['edit.transform', transform]])
  })
}

test('the engine’s bounds win over the template’s box', async () => {
  const doc = { layers: [{ ...BACKGROUND, bounds: [5, 6, 10, 20] }] }
  const { calls } = await edited({ 0: { sx: 2, dx: 1 } }, { doc })
  assert.deepEqual(calls, [['edit.transform', { layer: 10, rect: [5, 6, 15, 26], quad: rect(6, 6, 26, 26) }]])
})

test('text moves by its transform, about the layer’s corner', async () => {
  const answers = { 'type.info': { transform: [1, 0.5, 0.25, 2, 10, 20] } }
  const { calls } = await edited({ 1: { dx: 5, dy: -3, sx: 2, sy: 3 } }, { answers })
  assert.deepEqual(calls, [
    ['type.info', { layer: 11 }],
    ['type.edit', { layer: 11, transform: [2, 1.5, 0.5, 6, 23, 53] }],
  ])
})

test('text with no transform moves from the identity', async () => {
  const { calls } = await edited({ 1: { dx: 5, dy: -3, sx: 2, sy: 3 } })
  assert.deepEqual(calls[1], ['type.edit', { layer: 11, transform: [2, 0, 0, 3, 3, -7] }])
})

test('every step of one edit runs in order', async () => {
  const edit = { hidden: false, opacity: 1, text: 'Hi', textStyle: { sizePx: 24 }, dx: 1 }
  const { calls } = await edited({ 1: edit })
  assert.deepEqual(
    calls.map(([op]) => op),
    ['layer.setProps', 'layer.setProps', 'type.edit', 'type.setStyle', 'type.info', 'type.edit'],
  )
})

for (const [name, edit, op, warning, after] of [
  ['hiding', { hidden: false, opacity: 1 }, 'layer.setProps', 'show or hide it', 2],
  ['retyping', { text: 'Hi', textStyle: { sizePx: 24 } }, 'type.edit', 'retype it', 2],
  ['restyling', { textStyle: { sizePx: 24 }, dx: 1 }, 'type.setStyle', 'restyle it', 3],
  ['moving text', { dx: 1 }, 'type.info', 'move or resize it', 1],
]) {
  test(`a failure ${name} is a warning, and the next step still runs`, async () => {
    const { warnings, calls } = await edited({ 1: edit }, { fail: { [op]: true } })
    assert.equal(warnings[0], `“Title”: couldn't ${warning} (${op} failed)`)
    assert.equal(calls.length, after)
  })
}

for (const [name, edit, op, warning] of [
  ['opacity', { opacity: 0.5 }, 'layer.setProps', 'change its opacity'],
  ['a move', { dx: 1 }, 'layer.translate', 'move it'],
  ['a resize', { sx: 2 }, 'edit.transform', 'move or resize it'],
]) {
  test(`a failure at ${name} is a warning for its own layer, and the next edit still runs`, async () => {
    const { warnings, calls } = await edited({ 0: edit, 1: { text: 'Hi' } }, { fail: { [op]: true } })
    assert.deepEqual(warnings, [`“Background”: couldn't ${warning} (${op} failed)`])
    assert.deepEqual(calls.at(-1), ['type.edit', { layer: 11, text: 'Hi' }])
  })
}

for (const [name, edit, op, warning] of [
  ['opacity', { 0: { opacity: 0.5 } }, 'layer.setProps', "“Background”: couldn't change its opacity"],
  ['a retype', { 1: { text: 'Hi' } }, 'type.edit', "“Title”: couldn't retype it"],
  ['a move', { 0: { dx: 1 } }, 'layer.translate', "“Background”: couldn't move it"],
]) {
  test(`a failure at ${name} as the last step is in the warnings handed back`, async () => {
    const { warnings } = await edited(edit, { fail: { [op]: true } })
    assert.deepEqual(warnings, [`${warning} (${op} failed)`])
  })
}

test('a failure with no message is shown as it is', async () => {
  const { warnings } = await edited({ 0: { hidden: true } }, { fail: { 'layer.setProps': 'nope' } })
  assert.deepEqual(warnings, ["“Background”: couldn't show or hide it (nope)"])
})

test('several edits run in their order', async () => {
  const { calls } = await edited({ 1: { hidden: false }, 0: { hidden: true } })
  assert.deepEqual(calls, [visible(10, false), visible(11, true)])
})

// A real PSD always stores opacity and the area of a filled layer, so these come from a decoder stub.
function outline(t, children) {
  t.mock.method(ag, 'readPsd', () => ({ children }))
}

test('a layer with no stored opacity counts as 1', async (t) => {
  outline(t, [{ name: 'Background' }])
  assert.deepEqual((await edited({ 0: { opacity: 0.9995 } })).calls, [])
  assert.deepEqual((await edited({ 0: { opacity: 0.5 } })).calls, [opacity(10, 0.5)])
})

test('a change of exactly 0.001 is no change', async (t) => {
  outline(t, [{ name: 'Background', opacity: 0 }])
  assert.deepEqual((await edited({ 0: { opacity: 0.001 } })).calls, [])
})

test('a layer with no area of its own takes its mask’s', async (t) => {
  outline(t, [
    { name: 'Background', left: 3, top: 3, right: 3, bottom: 3, mask: { left: 1, top: 2, right: 5, bottom: 8 } },
  ])
  const { calls } = await edited({ 0: { sx: 2 } })
  assert.deepEqual(calls, [['edit.transform', { layer: 10, rect: [1, 2, 5, 8], quad: rect(1, 2, 9, 8) }]])
})

// ─── addOverlays ─────────────────────────────────────────────────────────────

const PLACE = { width: 1000, height: 800, tplIdx: 3 }
const TEXT = { type: 'text' }
const SHAPE = { type: 'rect' }
const BASE_LAYOUT = {
  anchorX: 10,
  firstBaseline: 20,
  lines: ['Hello', 'there'],
  align: 'left',
  font: 'Arial',
  weight: 700,
  italic: false,
  fontSize: 100,
  lineStep: 120,
  trackingEm: 0,
  color: '#112233',
  underline: false,
  opacity: 1,
  rot: 0,
  cx: 15,
  cy: 25,
}
const STACK = { resolution: 300, layers: [{ id: 50 }] }
const OTHER_ON_TOP = { resolution: 300, layers: [{ id: 99 }] }
const CREATE = 'type.create'
const CREATED = { [CREATE]: { layer: 50 } }

// Set by each row, read by the stubs above.
let scene = null
function stage(changes = {}) {
  scene = {
    layout: () => BASE_LAYOUT,
    shapes: (overlays) => overlays.some((o) => o && !o.hidden && o.type !== 'text'),
    png: async () => null,
    ...changes,
  }
}
async function placed(overlays, { doc = STACK, fail, answers = {}, ...changes } = {}) {
  stage(changes)
  const pc = fakePc({ doc, fail, answers: { ...CREATED, ...answers } })
  const warnings = await addOverlays(pc, overlays, PLACE)
  return { warnings, calls: pc.calls, ops: pc.calls.map(([op]) => op) }
}
const createdWith = (changes, options) => placed([TEXT], { layout: () => ({ ...BASE_LAYOUT, ...changes }), ...options })
const params = (result) => result.calls.find(([op]) => op === CREATE)[1]

for (const [name, overlays] of [
  ['not a list', 'text'],
  ['nothing', undefined],
  ['an empty list', []],
  [
    'all hidden',
    [
      { ...TEXT, hidden: true },
      { ...SHAPE, hidden: true },
    ],
  ],
  ['only nulls', [null, null]],
]) {
  test(`overlays that are ${name} ask nothing of the engine`, async () => {
    const { warnings, calls } = await placed(overlays)
    assert.deepEqual([warnings, calls], [[], []])
  })
}

test('one visible overlay is enough', async () => {
  const { ops } = await placed([{ ...TEXT, hidden: true }, null, TEXT])
  assert.equal(ops.filter((op) => op === CREATE).length, 1)
})

for (const [name, resolution, size] of [
  ['the document’s resolution', 300, 24],
  ['72 when the resolution is 0', 0, 100],
]) {
  test(`type sizes use ${name}`, async () => {
    assert.equal(params(await placed([TEXT], { doc: { ...STACK, resolution } })).size, size)
  })
}

test('text alone takes no shape steps', async () => {
  const { ops } = await placed([TEXT], { png: async () => assert.fail('no shapes to draw') })
  assert.deepEqual(ops, ['doc.inspect', CREATE, 'doc.inspect'])
})

test('shapes with nothing to draw open nothing', async () => {
  const { ops, warnings } = await placed([SHAPE], { png: async () => null })
  assert.deepEqual(ops, ['doc.inspect'])
  assert.deepEqual(warnings, [])
})

function shapeFile() {
  const file = path.join(tmpdir(), 'shapes.png')
  fs.writeFileSync(file, 'png')
  return file
}
const SHAPE_ANSWERS = { 'session.list': { active: 5 }, 'layer.copyToDocument': { layers: [77] } }
const shapesOn = (file, options) => placed([SHAPE], { png: async () => file, answers: SHAPE_ANSWERS, ...options })

test('shapes come in as one named layer on top, and their PNG goes', async () => {
  const file = shapeFile()
  let drawn
  const { calls, warnings } = await shapesOn(file, {
    png: async (...args) => {
      drawn = args
      return file
    },
  })
  assert.deepEqual(drawn, [[SHAPE], 1000, 800])
  assert.deepEqual(calls, [
    ['doc.inspect', {}],
    ['doc.open', { path: file.replace(/^\/+/, '') }],
    ['session.list', {}],
    ['layer.copyToDocument', { document: 3 }],
    ['doc.close', { index: 5 }],
    ['doc.select', { index: 3 }],
    ['layer.renameLayer', { layer: 77, name: 'Album Studio — text & shapes' }],
    ['doc.inspect', {}],
    ['layer.moveTo', { layer: 77, target: 50, position: 'above' }],
  ])
  assert.deepEqual(warnings, [])
  assert.equal(fs.existsSync(file), false)
})

for (const [name, doc, moves] of [
  ['no layers', { resolution: 300 }, false],
  ['an empty stack', { resolution: 300, layers: [] }, false],
  ['the new layer already on top', { resolution: 300, layers: [{ id: 77 }] }, false],
  ['another layer on top', STACK, true],
  ['a top with id 0', { resolution: 300, layers: [{ id: 0 }] }, true],
]) {
  test(`shapes with ${name} ${moves ? 'move' : 'stay where they are'}`, async () => {
    const { ops } = await shapesOn(shapeFile(), { doc })
    assert.equal(ops.includes('layer.moveTo'), moves)
  })
}

for (const op of [
  'doc.open',
  'session.list',
  'layer.copyToDocument',
  'doc.close',
  'doc.select',
  'layer.renameLayer',
  'layer.moveTo',
]) {
  test(`a shape step that fails at ${op} is a warning, and the PNG still goes`, async () => {
    const file = shapeFile()
    const { warnings, ops } = await shapesOn(file, { fail: { [op]: true } })
    assert.deepEqual(warnings, [`the shapes added in the spread editor couldn't be placed (${op} failed)`])
    assert.equal(ops.at(-1), op)
    assert.equal(fs.existsSync(file), false)
  })
}

test('text still goes on after the shapes fail', async () => {
  const { ops, warnings } = await placed([SHAPE, TEXT], {
    png: async () => {
      throw new Error('no drawing')
    },
  })
  assert.deepEqual(warnings, ["the shapes added in the spread editor couldn't be placed (no drawing)"])
  assert.ok(ops.includes(CREATE))
})

test('a PNG that can’t be removed is no one’s problem', async () => {
  const { warnings } = await shapesOn(path.join(tmpdir(), 'gone.png'))
  assert.deepEqual(warnings, [])
})

test('only visible text overlays are placed, in their order', async () => {
  const seen = []
  const overlays = [null, { ...TEXT, hidden: true }, SHAPE, { ...TEXT, id: 1 }, { ...TEXT, id: 2 }]
  await placed(overlays, {
    layout: (L, width, height) => {
      seen.push([L.id, width, height])
      return BASE_LAYOUT
    },
  })
  assert.deepEqual(seen, [
    [1, 1000, 800],
    [2, 1000, 800],
  ])
})

test('text with no layout is skipped', async () => {
  const { ops } = await placed([TEXT], { layout: () => null })
  assert.deepEqual(ops, ['doc.inspect'])
})

test('a text layer takes exactly these fields', async () => {
  assert.deepEqual(params(await createdWith({})), {
    x: 10,
    y: 20,
    text: 'Hello\nthere',
    name: 'Hello',
    align: 'left',
    font: 'Arial',
    weight: 700,
    italic: false,
    size: 24,
    leading: 28.8,
    tracking: 0,
    color: '#112233',
    underline: false,
  })
})

for (const [name, changes, field, value] of [
  ['no first line', { lines: [] }, 'name', 'Text'],
  ['an empty first line', { lines: ['', 'b'] }, 'name', 'Text'],
  ['a long first line', { lines: ['x'.repeat(41)] }, 'name', 'x'.repeat(40)],
  ['centred', { align: 'center' }, 'align', 'center'],
  ['right', { align: 'right' }, 'align', 'right'],
  ['left', { align: 'left' }, 'align', 'left'],
  ['justified', { align: 'justify' }, 'align', 'left'],
  ['italic, truthy', { italic: 1 }, 'italic', true],
  ['italic, falsy', { italic: undefined }, 'italic', false],
  ['underline, truthy', { underline: 1 }, 'underline', true],
  ['underline, falsy', { underline: undefined }, 'underline', false],
  ['tracking', { trackingEm: 0.0504 }, 'tracking', 50],
  ['no tracking', { trackingEm: undefined }, 'tracking', 0],
  ['a colour with alpha', { color: '#AABBCCDD' }, 'color', '#AABBCC'],
  ['a colour name', { color: 'red' }, 'color', '#111111'],
  ['no colour', { color: undefined }, 'color', '#111111'],
  ['a colour with a prefix', { color: 'x#AABBCC' }, 'color', '#111111'],
  ['a size that rounds', { fontSize: 7 }, 'size', 1.68],
  ['a line step that rounds', { lineStep: 7 }, 'leading', 1.68],
]) {
  test(`a text layer with ${name}`, async () => {
    assert.equal(params(await createdWith(changes))[field], value)
  })
}

test('opacity below 1 is set on the new layer', async () => {
  const { calls } = await createdWith({ opacity: 0.5 })
  assert.deepEqual(calls[2], ['layer.setProps', { layer: 50, opacity: 0.5 }])
})

test('full opacity needs no call', async () => {
  const { ops } = await createdWith({ opacity: 1 })
  assert.equal(ops.includes('layer.setProps'), false)
})

test('no rotation needs no call', async () => {
  const { ops } = await createdWith({ rot: 0 })
  assert.equal(ops.includes('type.edit'), false)
})

test('turned text pivots about the box centre', async () => {
  const { calls } = await createdWith({ rot: 30 })
  const [op, { layer, transform }] = calls[2]
  assert.deepEqual([op, layer], ['type.edit', 50])
  // cos 30° = √3/2, sin 30° = 1/2; the anchor is (-5, -5) from the pivot at (15, 25).
  const cos = Math.sqrt(3) / 2
  const expected = [cos, 0.5, -0.5, cos, 15 - 5 * cos + 2.5, 25 - 2.5 - 5 * cos]
  transform.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-12, `${i}: ${value}`))
})

for (const [name, doc, moved] of [
  ['no top', { resolution: 300 }, false],
  ['already on top', STACK, false],
  ['under another layer', OTHER_ON_TOP, true],
  ['under a layer with id 0', { resolution: 300, layers: [{ id: 0 }] }, true],
]) {
  test(`text ${name} ${moved ? 'moves to the top' : 'stays'}`, async () => {
    const { calls } = await placed([TEXT], { doc })
    const expected = moved ? [['layer.moveTo', { layer: 50, target: doc.layers[0].id, position: 'above' }]] : []
    assert.deepEqual(
      calls.filter(([op]) => op === 'layer.moveTo'),
      expected,
    )
  })
}

for (const [name, op, changes] of [
  ['creating', CREATE, {}],
  ['setting opacity', 'layer.setProps', { opacity: 0.5 }],
  ['turning', 'type.edit', { rot: 30 }],
  ['moving', 'layer.moveTo', {}],
]) {
  test(`a failure ${name} text is a warning, and the next text is still placed`, async () => {
    const layout = () => ({ ...BASE_LAYOUT, ...changes })
    const { warnings, ops } = await placed([TEXT, TEXT], { layout, doc: OTHER_ON_TOP, fail: { [op]: true } })
    assert.deepEqual(warnings, Array(2).fill(`the text “Hello” couldn't be added (${op} failed)`))
    assert.equal(ops.filter((called) => called === CREATE).length, 2)
  })
}
