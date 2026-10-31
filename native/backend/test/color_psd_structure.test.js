'use strict'

// Each rule the PSD composite parsers apply before they trust a document's structure: the message
// each gives, the documents just inside each limit, and the exact samples they decode. Documents are
// built section by section, so each row controls one field.

const test = require('node:test')
const assert = require('node:assert/strict')
const zlib = require('node:zlib')
const { loadPrivate } = require('./load_private')
const { decodeCmykComposite, decodeRgbComposite } = require('../lib/color')

const { compositeMetadata, compositePlanes } = loadPrivate('../lib/color.js', {
  names: ['compositeMetadata', 'compositePlanes'],
}).__private

const E = (detail) =>
  `The sheet composite cannot be delivered safely (${detail}). Save a real compatibility composite, or convert and save an 8-bit RGB sheet in the editor.`
const C = (detail) =>
  `The CMYK sheet cannot be delivered safely (${detail}). Save a real compatibility composite with its CMYK profile, ` +
  'or convert and save an 8-bit RGB sheet in the editor.'

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

/** A document, with `compositeAt` set to where the builder put the composite. */
function psd({
  version = 1,
  channels = 3,
  height = 2,
  width = 2,
  depth = 8,
  mode = 3,
  colour = [],
  resources = [],
  layers = null,
  data = null,
} = {}) {
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
  const front = [head, u32(colour.length), Buffer.from(colour), u32(resourceBytes.length), resourceBytes]
  const doc = Buffer.concat([...front, len(layerBytes.length, wide), layerBytes, plain])
  return Object.assign(doc, { compositeAt: doc.length - plain.length })
}
const resource = (id, body, { name = [0, 0], signature = '8BIM' } = {}) =>
  Buffer.concat([
    Buffer.from(signature),
    u16(id),
    Buffer.from(name),
    u32(body.length),
    body,
    Buffer.alloc(body.length % 2),
  ])
const merged = (flag) => resource(1057, Buffer.from([0, 0, 0, 1, flag]))
// A resource that claims more than its section holds, or an odd one with no pad.
const rawResource = (...parts) =>
  Buffer.concat([Buffer.from('8BIM'), u16(1), ...parts.map((part) => Buffer.from(part))])
// `count` null leaves the info section empty; a negative count declares merged transparency.
function layerSection(count, blocks = [], wide = 4) {
  const info = count === null ? Buffer.alloc(0) : Buffer.from([(count >> 8) & 255, count & 255])
  return Buffer.concat([len(info.length, wide), info, u32(0), ...blocks])
}
const block = (key, body, { signature = '8BIM', wide = 4 } = {}) =>
  Buffer.concat([Buffer.from(signature), Buffer.from(key), len(body.length, wide), Buffer.from(body)])
const ALPHA = [0xff, 0xff]
const NO_ALPHA = [0, 1]
const compressed = Buffer.from([0, 1]) // a composite that isn't raw, so no sample bytes are needed
const changed = (doc, change) => {
  change(doc)
  return doc
}
const full = (doc, fields = {}) => ({
  width: 2,
  height: 2,
  channels: 3,
  depth: 8,
  mode: 3,
  alpha: null,
  realMerged: null,
  compositeAt: doc.compositeAt,
  ...fields,
})

for (const [name, file, detail] of [
  ['29 bytes', Buffer.alloc(29), 'truncated document data'],
  ['a colour section past the end', changed(psd(), (d) => d.writeUInt32BE(d.length, 26)), 'truncated document data'],
  ['a resource section past the end', changed(psd(), (d) => d.writeUInt32BE(d.length, 30)), 'truncated document data'],
  ['6 bytes left in the resources', psd({ resources: [Buffer.alloc(6, 1)] }), 'truncated document data'],
  ['a resource name past its section', psd({ resources: [rawResource([200])] }), 'truncated document data'],
  ['a resource size past its section', psd({ resources: [rawResource([0, 0], u32(100))] }), 'truncated document data'],
  ['nothing after the layer section', psd({ data: Buffer.alloc(0) }), 'truncated document data'],
  ['a raw composite one byte short', psd({ data: Buffer.alloc(13) }), 'truncated document data'],
  ['a raw PSB composite one byte short', psd({ version: 2, data: Buffer.alloc(13) }), 'truncated document data'],
  ['a raw 16-bit composite one byte short', psd({ depth: 16, data: Buffer.alloc(25) }), 'truncated document data'],
  ['a layer length equal to the file', changed(psd(), (d) => d.writeUInt32BE(d.length, 34)), 'truncated document data'],
  ['a layer info section past the layers', psd({ layers: Buffer.concat([u32(4), u32(0)]) }), 'truncated document data'],
  [
    'a mask length past the layers',
    psd({ layers: Buffer.concat([u32(0), u32(9), u32(0)]) }),
    'truncated document data',
  ],
  [
    'a global block cut short',
    psd({ layers: layerSection(null, [Buffer.from('8BIMLayr')]) }),
    'truncated document data',
  ],
  [
    'a global block size past the layers',
    psd({ layers: layerSection(null, [Buffer.from('8BIMLayr'), u32(100)]) }),
    'invalid layer section length',
  ],
  ['8 zeros where a block belongs', psd({ layers: layerSection(null, [Buffer.alloc(8)]) }), 'truncated document data'],
  ['a signature of 8BPX', changed(psd(), (d) => d.write('8BPX', 0)), 'not a PSD/PSB document'],
  ['30 zero bytes', Buffer.alloc(30), 'not a PSD/PSB document'],
  ['version 3', psd({ version: 3 }), 'invalid header'],
  ['version 0', psd({ version: 0 }), 'invalid header'],
  ['depth 2', psd({ depth: 2 }), 'invalid header'],
  ['no channels', psd({ channels: 0 }), 'invalid header'],
  ['57 channels', psd({ channels: 57, data: compressed }), 'invalid header'],
  ['width 0', psd({ width: 0 }), 'invalid header'],
  ['height 0', psd({ height: 0 }), 'invalid header'],
  [
    'a PSD 30001 wide',
    psd({ width: 30001, height: 1, data: compressed }),
    'dimensions exceed the PSD/PSB format limit',
  ],
  [
    'a PSD 30001 high',
    psd({ width: 1, height: 30001, data: compressed }),
    'dimensions exceed the PSD/PSB format limit',
  ],
  [
    'a PSB 300001 wide',
    psd({ version: 2, width: 300001, height: 1, data: compressed }),
    'dimensions exceed the PSD/PSB format limit',
  ],
  [
    'a PSB 300001 high',
    psd({ version: 2, width: 1, height: 300001, data: compressed }),
    'dimensions exceed the PSD/PSB format limit',
  ],
  [
    '20000 × 20000',
    psd({ width: 20000, height: 20000, data: compressed }),
    'compatibility composite exceeds the 512 MiB decoding limit',
  ],
  [
    'just over 512 MiB',
    psd({ width: 16385, height: 8192, data: compressed }),
    'compatibility composite exceeds the 512 MiB decoding limit',
  ],
  [
    'a resource signed 8BIX',
    psd({ resources: [resource(1, Buffer.alloc(2), { signature: '8BIX' })] }),
    'invalid image resource',
  ],
  [
    'a merged declaration of 4 bytes',
    psd({ resources: [resource(1057, Buffer.from([0, 0, 0, 1]))] }),
    'invalid merged-composite declaration',
  ],
  [
    'a merged declaration of version 2',
    psd({ resources: [resource(1057, Buffer.from([0, 0, 0, 2, 1]))] }),
    'invalid merged-composite declaration',
  ],
  ['two merged declarations', psd({ resources: [merged(1), merged(1)] }), 'invalid merged-composite declaration'],
  [
    'an odd resource with no pad at the end',
    psd({ resources: [rawResource([0, 0], u32(1), [7])] }),
    'truncated image resource padding',
  ],
  [
    'a PSD layer length too long',
    changed(psd(), (d) => d.writeUInt32BE(d.length + 1, 34)),
    'invalid layer section length',
  ],
  [
    'a PSB layer length too long',
    changed(psd({ version: 2 }), (d) => d.writeUInt32BE(d.length + 1, 38)),
    'invalid layer section length',
  ],
  [
    'a PSB layer length past 32 bits',
    changed(psd({ version: 2 }), (d) => d.writeUInt32BE(1, 34)),
    'invalid layer section length',
  ],
  [
    'a layer info section of 1 byte',
    psd({ layers: Buffer.concat([u32(1), Buffer.alloc(1), u32(0)]) }),
    'truncated layer count',
  ],
  ['a global block of 1 byte', psd({ layers: layerSection(null, [block('Layr', [0])]) }), 'truncated layer count'],
  [
    'the primary count and Lr16 disagreeing',
    psd({ depth: 16, layers: layerSection(1, [block('Lr16', ALPHA)]) }),
    'conflicting merged transparency declarations',
  ],
  [
    'the primary count and Layr disagreeing',
    psd({ channels: 4, layers: layerSection(-1, [block('Layr', NO_ALPHA)]) }),
    'conflicting merged transparency declarations',
  ],
  [
    'a block signed 8BXX',
    psd({ layers: layerSection(null, [block('Layr', NO_ALPHA, { signature: '8BXX' })]) }),
    'invalid global layer block',
  ],
  [
    '4 bytes of padding',
    psd({ layers: layerSection(null, [Buffer.alloc(4), block('Layr', NO_ALPHA)]) }),
    'invalid global layer block',
  ],
  ['RGB with 2 channels', psd({ channels: 2 }), 'unsupported RGB extra channels'],
  ['RGB with 5 channels', psd({ channels: 5 }), 'unsupported RGB extra channels'],
  ['transparency declared on 3 channels', psd({ layers: layerSection(-1) }), 'merged transparency channel is missing'],
  ['4 channels with no declaration', psd({ channels: 4 }), 'fourth-channel transparency provenance is unknown'],
  // The first failure wins, because that's the message the user acts on.
  [
    'first failure wins: a bad version and a bad resource',
    psd({ version: 3, resources: [resource(1, Buffer.alloc(2), { signature: '8BIX' })] }),
    'invalid header',
  ],
  [
    'first failure wins: a bad header and a bad size',
    psd({ width: 30001, depth: 2, data: compressed }),
    'invalid header',
  ],
  [
    'first failure wins: conflicting blocks, then a bad signature',
    psd({
      layers: layerSection(null, [
        block('Layr', NO_ALPHA),
        block('Layr', ALPHA),
        block('Layr', NO_ALPHA, { signature: '8BXX' }),
      ]),
    }),
    'conflicting merged transparency declarations',
  ],
  [
    'first failure wins: a bad resource, then a bad layer length',
    changed(psd({ resources: [resource(1, Buffer.alloc(2), { signature: '8BIX' })] }), (d) =>
      d.writeUInt32BE(d.length + 1, 34 + 14),
    ),
    'invalid image resource',
  ],
  [
    'first failure wins: a bad block, then bad RGB channels',
    psd({ channels: 2, layers: layerSection(null, [block('Layr', NO_ALPHA, { signature: '8BXX' })]) }),
    'invalid global layer block',
  ],
]) {
  test(`compositeMetadata refuses ${name}`, () => {
    assert.throws(() => compositeMetadata(file), { message: E(detail) })
  })
}

for (const [name, doc, fields] of [
  ['the plainest document', psd()],
  ['depth 1', psd({ depth: 1, data: Buffer.alloc(2) }), { depth: 1 }],
  ['depth 16', psd({ depth: 16 }), { depth: 16 }],
  ['depth 32', psd({ depth: 32 }), { depth: 32 }],
  ['a PSD 30000 wide and high', psd({ width: 30000, height: 1, data: compressed }), { width: 30000, height: 1 }],
  ['a PSD 30000 high', psd({ width: 1, height: 30000, data: compressed }), { width: 1, height: 30000 }],
  ['a PSB', psd({ version: 2 })],
  [
    'a PSB past the PSD limit',
    psd({ version: 2, width: 30001, height: 1, data: compressed }),
    { width: 30001, height: 1 },
  ],
  ['a PSB 300000 wide', psd({ version: 2, width: 300000, height: 1, data: compressed }), { width: 300000, height: 1 }],
  ['a PSB 300000 high', psd({ version: 2, width: 1, height: 300000, data: compressed }), { width: 1, height: 300000 }],
  ['exactly 512 MiB decoded', psd({ width: 16384, height: 8192, data: compressed }), { width: 16384, height: 8192 }],
  ['56 channels', psd({ mode: 1, channels: 56, data: compressed }), { mode: 1, channels: 56 }],
  ['a colour section', psd({ colour: [1, 2, 3] })],
  [
    'an even name',
    psd({ resources: [resource(1057, Buffer.from([0, 0, 0, 1, 1]), { name: [1, 65] })] }),
    { realMerged: true },
  ],
  [
    'an odd name',
    psd({ resources: [resource(1057, Buffer.from([0, 0, 0, 1, 1]), { name: [2, 65, 66, 0] })] }),
    { realMerged: true },
  ],
  [
    'a merged declaration of 6 bytes',
    psd({ resources: [resource(1057, Buffer.from([0, 0, 0, 1, 1, 0]))] }),
    { realMerged: true },
  ],
  ['merged flag 0', psd({ resources: [merged(0)] }), { realMerged: false }],
  ['merged flag 1', psd({ resources: [merged(1)] }), { realMerged: true }],
  [
    'another resource after the declaration',
    psd({ resources: [merged(1), resource(1, Buffer.alloc(2))] }),
    { realMerged: true },
  ],
  ['an odd resource, padded', psd({ resources: [resource(1, Buffer.alloc(1)), merged(0)] }), { realMerged: false }],
  ['count -1', psd({ channels: 4, layers: layerSection(-1) }), { channels: 4, alpha: true }],
  ['count 1', psd({ layers: layerSection(1) }), { alpha: false }],
  ['count 0', psd({ layers: layerSection(0) }), { alpha: false }],
  ['count 1 on 4 channels', psd({ channels: 4, layers: layerSection(1) }), { channels: 4, alpha: false }],
  ['no layer info', psd({ layers: layerSection(null) })],
  [
    'the primary count and Lr16 agreeing',
    psd({ depth: 16, layers: layerSection(1, [block('Lr16', NO_ALPHA)]) }),
    { depth: 16, alpha: false },
  ],
  [
    'a mask section',
    psd({ layers: Buffer.concat([u32(0), u32(4), u32(0), block('Layr', NO_ALPHA)]) }),
    { alpha: false },
  ],
  [
    'a greyscale document, whose layers are not read',
    psd({ mode: 1, channels: 1, layers: Buffer.alloc(4, 0xff) }),
    { mode: 1, channels: 1 },
  ],
  [
    'a CMYK document, whose layers are read',
    psd({ mode: 4, channels: 5, layers: layerSection(-1) }),
    { mode: 4, channels: 5, alpha: true },
  ],
  ['no padding before a block', psd({ layers: layerSection(null, [block('Layr', NO_ALPHA)]) }), { alpha: false }],
  [
    '1 byte of padding',
    psd({ layers: layerSection(null, [Buffer.alloc(1), block('Layr', NO_ALPHA)]) }),
    { alpha: false },
  ],
  [
    '2 bytes of padding',
    psd({ layers: layerSection(null, [Buffer.alloc(2), block('Layr', NO_ALPHA)]) }),
    { alpha: false },
  ],
  [
    '3 bytes of padding',
    psd({ layers: layerSection(null, [Buffer.alloc(3), block('Layr', NO_ALPHA)]) }),
    { alpha: false },
  ],
  ['zeros to the end of the layers', psd({ layers: layerSection(null, [Buffer.alloc(3)]) })],
  ['2 zeros, then exactly the end', psd({ layers: layerSection(null, [Buffer.alloc(2)]) })],
  [
    'an 8B64 block',
    psd({ layers: layerSection(null, [block('Layr', NO_ALPHA, { signature: '8B64', wide: 8 })]) }),
    { alpha: false },
  ],
  [
    'a long key in a PSB',
    psd({ version: 2, layers: layerSection(null, [block('Layr', NO_ALPHA, { wide: 8 })], 8) }),
    { alpha: false },
  ],
  [
    'a short key in a PSB',
    psd({
      version: 2,
      layers: layerSection(null, [block('lfx2', Buffer.alloc(4)), block('Layr', NO_ALPHA, { wide: 8 })], 8),
    }),
    { alpha: false },
  ],
  [
    'a long key in a PSD',
    psd({ layers: layerSection(null, [block('Lr16', Buffer.alloc(4)), block('Layr', NO_ALPHA)]) }),
    { alpha: false },
  ],
  [
    'Layr at depth 16',
    psd({ depth: 16, layers: layerSection(null, [block('Layr', NO_ALPHA)]) }),
    { depth: 16, alpha: false },
  ],
  [
    'Layr at depth 32',
    psd({ depth: 32, layers: layerSection(null, [block('Layr', NO_ALPHA)]) }),
    { depth: 32, alpha: false },
  ],
  ['Lr16 at depth 8', psd({ layers: layerSection(null, [block('Lr16', NO_ALPHA)]) })],
  [
    'Lr16 at depth 16',
    psd({ depth: 16, layers: layerSection(null, [block('Lr16', NO_ALPHA)]) }),
    { depth: 16, alpha: false },
  ],
  ['Lr16 at depth 32', psd({ depth: 32, layers: layerSection(null, [block('Lr16', NO_ALPHA)]) }), { depth: 32 }],
  ['Lr32 at depth 8', psd({ layers: layerSection(null, [block('Lr32', NO_ALPHA)]) })],
  [
    'Lr32 at depth 32',
    psd({ depth: 32, layers: layerSection(null, [block('Lr32', NO_ALPHA)]) }),
    { depth: 32, alpha: false },
  ],
  ['Lr32 at depth 16', psd({ depth: 16, layers: layerSection(null, [block('Lr32', NO_ALPHA)]) }), { depth: 16 }],
  ['a raw composite of exactly its size', psd({ data: Buffer.alloc(14) })],
  ['a short raw composite at depth 1', psd({ depth: 1, data: Buffer.alloc(2) }), { depth: 1 }],
  ['a short compressed composite', psd({ data: compressed })],
  [
    'a CMYK document with a short composite',
    psd({ mode: 4, channels: 4, data: Buffer.alloc(2) }),
    { mode: 4, channels: 4 },
  ],
]) {
  test(`compositeMetadata reads ${name}`, () => {
    const metadata = compositeMetadata(doc)
    assert.deepEqual(metadata, full(doc, fields))
    assert.deepEqual(Object.keys(metadata), Object.keys(full(doc)))
  })
}

// ─── compositePlanes ─────────────────────────────────────────────────────────

// Only what compositePlanes reads: the version at 4, then the compression at 6.
const AT = 6
const planeFile = (compression, body = [], version = 1) =>
  Buffer.concat([Buffer.alloc(4), u16(version), u16(compression), Buffer.from(body)])
const detail = (text) => new Error(text)
const shape = (width, height = 1, channels = 1, depth = 8) => ({ width, height, channels, depth })
const rle = (...rows) => {
  const table = rows.map((row) => [...u16(row.length)])
  return [...table.flat(), ...rows.flat()]
}
const zip = (bytes) => zlib.deflateSync(Buffer.from(bytes))

for (const [name, file, target, at, message] of [
  ['depth 32', planeFile(0), shape(1, 1, 3, 32), AT, 'unsupported or oversized compatibility composite'],
  ['an unsafe size', planeFile(0), shape(2 ** 53), AT, 'unsupported or oversized compatibility composite'],
  ['1 GiB', planeFile(0), shape(2 ** 30), AT, 'unsupported or oversized compatibility composite'],
  ['a compression offset of -1', planeFile(0), shape(1), -1, 'truncated document data'],
  ['a compression offset of 1.5', planeFile(0), shape(1), 1.5, 'truncated document data'],
  ['a compression offset past the end', planeFile(0), shape(1), 7, 'truncated document data'],
  ['a negative width with raw data', planeFile(0, [1, 2]), shape(-2), AT, 'truncated document data'],
  ['exactly the size limit with no data', planeFile(0), shape(2 ** 29), AT, 'truncated document data'],
  ['raw data one byte short', planeFile(0, [1]), shape(2), AT, 'truncated document data'],
  ['a fractional table size', planeFile(1, [0, 0, 0, 0]), shape(4, 0.25), AT, 'truncated document data'],
  ['a table past the end', planeFile(1, [0]), shape(2), AT, 'truncated document data'],
  ['a PSB table past the end', planeFile(1, [0, 0, 0], 2), shape(2), AT, 'truncated document data'],
  ['rows past the end', planeFile(1, [0, 3, 1, 10]), shape(2), AT, 'truncated document data'],
  ['a PSB row past the end', planeFile(1, [0, 0, 0, 3, 1, 10], 2), shape(2), AT, 'truncated document data'],
  ['an empty row at the end of the file', planeFile(1, [0, 0]), shape(2), AT, 'truncated RLE row'],
  ['a literal past its row', planeFile(1, rle([1, 10])), shape(2), AT, 'truncated RLE literal'],
  ['a repeat with no value', planeFile(1, rle([255])), shape(2), AT, 'truncated RLE repeat'],
  ['a literal row too long', planeFile(1, rle([2, 1, 2, 3])), shape(2), AT, 'an RLE row exceeds its width'],
  ['a repeat row too long', planeFile(1, rle([254, 9])), shape(2), AT, 'an RLE row exceeds its width'],
  ['a row too short', planeFile(1, rle([0, 1])), shape(2), AT, 'truncated RLE row'],
  ['a row with only a no-op', planeFile(1, rle([128])), shape(2), AT, 'truncated RLE row'],
  ['bad deflate data', planeFile(2, [1, 2, 3]), shape(2), AT, 'invalid or oversized ZIP composite'],
  ['deflate data too long', planeFile(2, zip([1, 2, 3])), shape(2), AT, 'invalid or oversized ZIP composite'],
  ['deflate data too short', planeFile(2, zip([1])), shape(2), AT, 'ZIP composite length does not match its planes'],
  [
    'predicted deflate data too short',
    planeFile(3, zip([1])),
    shape(2),
    AT,
    'ZIP composite length does not match its planes',
  ],
  ['compression 4', planeFile(4), shape(2), AT, 'unsupported composite compression'],
]) {
  test(`compositePlanes refuses ${name}`, () => {
    assert.throws(() => compositePlanes(file, target, at, detail), { message })
  })
}

test('compositePlanes uses the sheet error unless told otherwise', () => {
  assert.throws(() => compositePlanes(planeFile(4), shape(2), AT), { message: E('unsupported composite compression') })
})

test('raw planes come back as a view of the file', () => {
  const file = planeFile(0, [1, 2, 3])
  const planes = compositePlanes(file, shape(2), AT, detail)
  assert.deepEqual([...planes], [1, 2])
  assert.equal(planes.buffer, file.buffer)
  assert.equal(planes.byteOffset, file.byteOffset + 8)
})

test('a compression field at the very start of the buffer is in bounds', () => {
  assert.deepEqual([...compositePlanes(Buffer.from([0, 0, 7]), shape(1), 0, detail)], [7])
})

for (const [name, file, target, expected] of [
  ['RLE literals', planeFile(1, rle([1, 10, 20])), shape(2), [10, 20]],
  ['RLE with a PSB table', planeFile(1, [0, 0, 0, 3, 1, 10, 20], 2), shape(2), [10, 20]],
  ['RLE skips its no-op', planeFile(1, rle([128, 1, 10, 20])), shape(2), [10, 20]],
  ['an RLE repeat', planeFile(1, rle([255, 9])), shape(2), [9, 9]],
  ['a literal then a repeat', planeFile(1, rle([0, 7, 254, 9])), shape(4), [7, 9, 9, 9]],
  ['two RLE rows', planeFile(1, rle([1, 1, 2], [1, 3, 4])), shape(2, 2), [1, 2, 3, 4]],
  ['two channels of RLE', planeFile(1, rle([1, 1, 2], [255, 5])), shape(2, 1, 2), [1, 2, 5, 5]],
  ['16-bit RLE', planeFile(1, rle([3, 1, 2, 3, 4])), shape(2, 1, 1, 16), [1, 2, 3, 4]],
  ['two PSB rows', planeFile(1, [0, 0, 0, 3, 0, 0, 0, 2, 1, 1, 2, 255, 5], 2), shape(2, 2), [1, 2, 5, 5]],
  ['deflate', planeFile(2, zip([1, 2, 3, 4])), shape(2, 2), [1, 2, 3, 4]],
  ['8-bit prediction', planeFile(3, zip([1, 2, 3])), shape(3), [1, 3, 6]],
  ['8-bit prediction wraps at 255', planeFile(3, zip([200, 100])), shape(2), [200, 44]],
  ['prediction restarts on each row', planeFile(3, zip([1, 1, 5, 1])), shape(2, 2), [1, 2, 5, 6]],
  ['16-bit prediction', planeFile(3, zip([0, 1, 0, 2])), shape(2, 1, 1, 16), [0, 1, 0, 3]],
  [
    '16-bit prediction wraps at 65535',
    planeFile(3, zip([0xff, 0xf0, 0, 0x20])),
    shape(2, 1, 1, 16),
    [0xff, 0xf0, 0, 0x10],
  ],
]) {
  test(`compositePlanes decodes ${name}`, () => {
    assert.deepEqual([...compositePlanes(file, target, AT, detail)], expected)
  })
}

// ─── decodeCmykComposite ─────────────────────────────────────────────────────

const cmyk = (options) => psd({ mode: 4, channels: 4, ...options })

for (const [name, file, message] of [
  ['a short file', Buffer.alloc(29), 'truncated document data'],
  ['a resource section past the end', changed(cmyk(), (d) => d.writeUInt32BE(d.length, 30)), 'truncated document data'],
  ['a colour section past the end', changed(cmyk(), (d) => d.writeUInt32BE(d.length, 26)), 'truncated document data'],
  ['6 bytes left in the file', cmyk({ resources: [Buffer.alloc(6, 1)] }).subarray(0, 40), 'truncated document data'],
  [
    'a layer section past the end',
    changed(cmyk(), (d) => d.writeUInt32BE(d.length - 1, 34)),
    'truncated document data',
  ],
  [
    'a layer length equal to the file',
    changed(cmyk(), (d) => d.writeUInt32BE(d.length, 34)),
    'truncated document data',
  ],
  [
    'a layer length cut off',
    changed(cmyk({ data: Buffer.alloc(0) }), (d) => d.writeUInt32BE(0, 30)).subarray(0, 36),
    'truncated document data',
  ],
  ['a raw composite one byte short', cmyk({ data: Buffer.alloc(17) }), 'truncated document data'],
  ['a PSD 30000 wide, with no data', cmyk({ width: 30000, height: 1, data: compressed }), 'truncated document data'],
  ['a PSD 30000 high, with no data', cmyk({ width: 1, height: 30000, data: compressed }), 'truncated document data'],
  [
    'a PSB 300000 wide, with no data',
    cmyk({ version: 2, width: 300000, height: 1, data: compressed }),
    'truncated document data',
  ],
  [
    'a PSB 300000 high, with no data',
    cmyk({ version: 2, width: 1, height: 300000, data: compressed }),
    'truncated document data',
  ],
  ['exactly 512 MiB, with no data', cmyk({ width: 16384, height: 8192, data: compressed }), 'truncated document data'],
  ['a signature of 8BPX', changed(cmyk(), (d) => d.write('8BPX', 0)), 'not a CMYK PSD/PSB'],
  ['mode 3', cmyk({ mode: 3 }), 'not a CMYK PSD/PSB'],
  ['exactly a header, in mode 3', cmyk({ mode: 3 }).subarray(0, 30), 'not a CMYK PSD/PSB'],
  ['version 3', cmyk({ version: 3 }), 'unsupported depth or extra spot channels'],
  ['depth 32', cmyk({ depth: 32 }), 'unsupported depth or extra spot channels'],
  ['width 0', cmyk({ width: 0 }), 'unsupported depth or extra spot channels'],
  ['height 0', cmyk({ height: 0 }), 'unsupported depth or extra spot channels'],
  ['3 channels', cmyk({ channels: 3 }), 'unsupported depth or extra spot channels'],
  ['6 channels', cmyk({ channels: 6 }), 'unsupported depth or extra spot channels'],
  [
    'a PSD 30001 wide',
    cmyk({ width: 30001, height: 1, data: compressed }),
    'dimensions exceed the PSD/PSB format limit',
  ],
  [
    'a PSD 30001 high',
    cmyk({ width: 1, height: 30001, data: compressed }),
    'dimensions exceed the PSD/PSB format limit',
  ],
  [
    'a PSB 300001 wide',
    cmyk({ version: 2, width: 300001, height: 1, data: compressed }),
    'dimensions exceed the PSD/PSB format limit',
  ],
  [
    'a PSB 300001 high',
    cmyk({ version: 2, width: 1, height: 300001, data: compressed }),
    'dimensions exceed the PSD/PSB format limit',
  ],
  [
    '20000 × 20000',
    cmyk({ width: 20000, height: 20000, data: compressed }),
    'compatibility composite exceeds the 512 MiB decoding limit',
  ],
  [
    'a resource signed 8BIX',
    cmyk({ resources: [resource(1, Buffer.alloc(2), { signature: '8BIX' })] }),
    'invalid resource signature',
  ],
  ['a resource name past its section', cmyk({ resources: [rawResource([200])] }), 'truncated resource name'],
  ['a resource size past its section', cmyk({ resources: [rawResource([0, 0], u32(100))] }), 'truncated resource'],
  [
    'a merged declaration of 4 bytes',
    cmyk({ resources: [resource(1057, Buffer.from([0, 0, 0, 1]))] }),
    'invalid merged-composite declaration',
  ],
  [
    'a merged declaration of version 2',
    cmyk({ resources: [resource(1057, Buffer.from([0, 0, 0, 2, 1]))] }),
    'invalid merged-composite declaration',
  ],
  ['two merged declarations', cmyk({ resources: [merged(1), merged(1)] }), 'invalid merged-composite declaration'],
  [
    'an odd resource with no pad',
    cmyk({ resources: [rawResource([0, 0], u32(1), [7])] }),
    'truncated resource padding',
  ],
  ['merged flag 0', cmyk({ resources: [merged(0)] }), 'the document declares no real merged composite'],
  [
    'a PSD layer length too long',
    changed(cmyk(), (d) => d.writeUInt32BE(d.length + 1, 34)),
    'invalid layer section length',
  ],
  [
    'a PSB layer length too long',
    changed(cmyk({ version: 2 }), (d) => d.writeUInt32BE(d.length + 1, 38)),
    'invalid layer section length',
  ],
  [
    'a PSB layer length past 32 bits',
    changed(cmyk({ version: 2 }), (d) => d.writeUInt32BE(1, 34)),
    'invalid layer section length',
  ],
  ['transparency declared on 4 channels', cmyk({ layers: layerSection(-1) }), 'transparency plane is missing'],
  [
    'a fifth channel not declared as transparency',
    cmyk({ channels: 5, layers: layerSection(1) }),
    'an extra channel is not identified as transparency',
  ],
  ['a fifth channel with no declaration', cmyk({ channels: 5 }), 'an extra channel is not identified as transparency'],
  // The first failure wins, because that's the message the user acts on.
  ['first failure wins: a bad mode and a bad version', cmyk({ mode: 3, version: 3 }), 'not a CMYK PSD/PSB'],
  [
    'first failure wins: a bad version and a bad size',
    cmyk({ version: 3, width: 30001, height: 1, data: compressed }),
    'unsupported depth or extra spot channels',
  ],
  [
    'first failure wins: a bad resource and merged flag 0',
    cmyk({ resources: [merged(0), resource(1, Buffer.alloc(2), { signature: '8BIX' })] }),
    'invalid resource signature',
  ],
  [
    'first failure wins: a missing plane, then short data',
    cmyk({ layers: layerSection(-1), data: Buffer.alloc(3) }),
    'transparency plane is missing',
  ],
]) {
  test(`decodeCmykComposite refuses ${name}`, () => {
    assert.throws(() => decodeCmykComposite(file), { message: C(message) })
  })
}

test('a CMYK document also meets the structural rules of any PSD', () => {
  const blocks = layerSection(null, [block('Layr', NO_ALPHA, { signature: '8BXX' })])
  assert.throws(() => decodeCmykComposite(cmyk({ layers: blocks })), { message: E('invalid global layer block') })
})

const raw8 = (...samples) => Buffer.from([0, 0, ...samples])
const raw16 = (...samples) => Buffer.concat([u16(0), ...samples.map(u16)])
const le16 = (...samples) => {
  const out = Buffer.alloc(samples.length * 2)
  samples.forEach((sample, i) => out.writeUInt16LE(sample, i * 2))
  return [...out]
}

for (const [name, options, expected, fields] of [
  [
    '8-bit samples, inverted to ink',
    { width: 2, height: 1, data: raw8(10, 20, 30, 40, 50, 60, 70, 80) },
    [245, 225, 205, 185, 235, 215, 195, 175],
  ],
  [
    '16-bit samples, little-endian',
    { width: 2, height: 1, depth: 16, data: raw16(0x0102, 0x0304, 0x0506, 0x0708, 0x090a, 0x0b0c, 0x0d0e, 0x0f10) },
    le16(0xfefd, 0xfaf9, 0xf6f5, 0xf2f1, 0xfcfb, 0xf8f7, 0xf4f3, 0xf0ef),
  ],
  [
    'alpha 0 clears the ink',
    { channels: 5, width: 1, height: 1, layers: layerSection(-1), data: raw8(10, 20, 30, 40, 0) },
    [0, 0, 0, 0, 0],
    { alpha: true },
  ],
  [
    'alpha 128 divides the matte, capped at full ink',
    { channels: 5, width: 1, height: 1, layers: layerSection(-1), data: raw8(255, 200, 150, 0, 128) },
    [0, 110, 209, 255, 128],
    { alpha: true },
  ],
  [
    'alpha 255 keeps the ink',
    { channels: 5, width: 1, height: 1, layers: layerSection(-1), data: raw8(10, 20, 30, 40, 255) },
    [245, 235, 225, 215, 255],
    { alpha: true },
  ],
  [
    '16-bit alpha',
    {
      channels: 5,
      width: 1,
      height: 1,
      depth: 16,
      layers: layerSection(-1),
      data: raw16(0xffff, 0x8000, 0, 0x7fff, 0x8000),
    },
    le16(0, 0xfffd, 0xffff, 0xffff, 0x8000),
    { alpha: true },
  ],
  [
    'count 1 on 4 channels is no alpha',
    { width: 1, height: 1, layers: layerSection(1), data: raw8(10, 20, 30, 40) },
    [245, 235, 225, 215],
  ],
]) {
  test(`decoded samples keep their bytes: ${name}`, () => {
    const doc = cmyk(options)
    const decoded = decodeCmykComposite(doc)
    assert.deepEqual([...decoded.data], expected, name)
    const { data, ...rest } = decoded
    assert.deepEqual(rest, {
      width: options.width,
      height: options.height,
      channels: options.channels || 4,
      depth: options.depth || 8,
      alpha: false,
      ...fields,
    })
    assert.equal(data.length, expected.length)
  })
}

test('decoded samples keep their bytes: compressed CMYK planes', () => {
  const file = cmyk({ width: 2, height: 1, data: Buffer.concat([u16(3), zip([1, 1, 2, 2, 3, 3, 4, 4])]) })
  assert.deepEqual([...decodeCmykComposite(file).data], [254, 253, 252, 251, 253, 251, 249, 247])
})

for (const [name, options, expected] of [
  [
    '8-bit RGB gains an opaque alpha',
    { width: 2, height: 1, data: raw8(1, 2, 3, 4, 5, 6) },
    [1, 3, 5, 255, 2, 4, 6, 255],
  ],
  [
    '16-bit RGB, little-endian',
    { width: 1, height: 1, depth: 16, data: raw16(0x0102, 0x0304, 0x0506) },
    le16(0x0102, 0x0304, 0x0506, 0xffff),
  ],
  [
    'alpha 0 clears the colour',
    { channels: 4, width: 1, height: 1, layers: layerSection(-1), data: raw8(255, 128, 0, 0) },
    [0, 0, 0, 0],
  ],
  [
    'partial alpha is unmatted from white',
    { channels: 4, width: 1, height: 1, layers: layerSection(-1), data: raw8(255, 200, 128, 128) },
    [255, 145, 2, 128],
  ],
  [
    '16-bit partial alpha',
    {
      channels: 4,
      width: 1,
      height: 1,
      depth: 16,
      layers: layerSection(-1),
      data: raw16(0xffff, 0xc000, 0x8000, 0x8000),
    },
    le16(0xffff, 0x8001, 2, 0x8000),
  ],
]) {
  test(`decoded samples keep their bytes: ${name}`, () => {
    assert.deepEqual([...decodeRgbComposite(psd(options)).data], expected)
  })
}
