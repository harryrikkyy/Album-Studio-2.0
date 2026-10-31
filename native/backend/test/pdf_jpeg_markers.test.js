'use strict'

// Each rule jpegInfo applies to a page's JPEG before a PDF embeds its bytes unchanged: the message
// it gives, and the files just inside each rule. The files are built from bytes, so each row states
// exactly what's in it.

const test = require('node:test')
const assert = require('node:assert/strict')
const { loadPrivate } = require('./load_private')
const { adobeCompatibleProfile, grayGammaProfile } = require('./color_edge_fixtures')

const { jpegInfo } = loadPrivate('../lib/pdf.js', { names: ['jpegInfo'] }).__private

const seg = (marker, payload = []) =>
  Buffer.from([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload])
const sof = (marker = 0xc0, { precision = 8, height = 2, width = 3, ids = [1, 2, 3] } = {}) =>
  seg(marker, [precision, 0, height, 0, width, ids.length, ...ids.flatMap((id) => [id, 0x11, 0])])
const sos = (ids = [1, 2, 3]) => seg(0xda, [ids.length, ...ids.flatMap((id) => [id, 0]), 0, 63, 0])
const jpeg = (...parts) => Buffer.concat([Buffer.from([0xff, 0xd8]), ...parts, Buffer.from([0xff, 0xd9])])
const raw = (...bytes) => Buffer.from(bytes)
const data = raw(0x12, 0x34)
const ok = (...extra) => jpeg(...extra, sof(), sos(), data)
const icc = (sequence, total, bytes = []) => seg(0xe2, [...Buffer.from('ICC_PROFILE\0'), sequence, total, ...bytes])

const SIGNATURE = 'Invalid JPEG signature.'
const MARKER = 'Invalid JPEG marker.'
const TRUNCATED = 'Truncated JPEG data, missing frame or missing SOS scan.'
const LENGTH = 'Truncated JPEG marker length.'
const SEGMENT = 'Truncated JPEG segment.'
const FRAME = 'Unsupported or malformed JPEG DCT frame.'
const DUPLICATE_COMPONENT = 'Duplicate JPEG frame components.'
const SCAN = 'Malformed JPEG SOS scan header.'
const SCAN_COMPONENT = 'Invalid JPEG scan component.'
const ICC_HEADER = 'Truncated JPEG ICC header.'
const ICC_SEQUENCE = 'Invalid JPEG ICC chunk sequence.'
const ICC_DUPLICATE = 'Duplicate JPEG ICC chunk.'
const ICC_MISSING = 'Missing JPEG ICC chunk.'
const ICC_CHANNELS = 'JPEG ICC profile channel mismatch.'
const NO_ENTROPY = 'The JPEG scan has no entropy data.'
const DIMENSIONS = 'Invalid JPEG dimensions.'
const PROFILE = 'The sheet has an invalid colour profile. Assign a valid profile in the editor before exporting.'

const plain = { width: 3, height: 2, components: 3, profile: null }

for (const [name, file, message] of [
  ['three bytes', raw(0xff, 0xd8, 0xff), SIGNATURE],
  ['no start marker', raw(0xff, 0xd9, 0, 0), SIGNATURE],
  ['junk where a marker belongs', raw(0xff, 0xd8, 0, 0, 0, 0), MARKER],
  ['fill bytes, then the end marker', raw(0xff, 0xd8, 0xff, 0xff, 0xff, 0xd9), TRUNCATED],
  ['fill bytes to the end', raw(0xff, 0xd8, 0xff, 0xff), MARKER],
  ['a second start marker', raw(0xff, 0xd8, 0xff, 0xd8, 0xff, 0xd9), MARKER],
  ['a stuffed zero outside a scan', raw(0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9), MARKER],
  ['a length field missing', raw(0xff, 0xd8, 0xff, 0xe0), LENGTH],
  ['half a length field', raw(0xff, 0xd8, 0xff, 0xe0, 0x00), LENGTH],
  ['length 1', raw(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0xff, 0xd9), SEGMENT],
  ['a length past the end', raw(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x09, 0x00), SEGMENT],
  ['length 2 at the very end', raw(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02), TRUNCATED],
  ['lossless SOF3', jpeg(sof(0xc3), sos(), data), FRAME],
  ['hierarchical SOF5', jpeg(sof(0xc5), sos(), data), FRAME],
  ['hierarchical SOF6', jpeg(sof(0xc6), sos(), data), FRAME],
  ['hierarchical SOF7', jpeg(sof(0xc7), sos(), data), FRAME],
  ['lossless arithmetic SOF11', jpeg(sof(0xcb), sos(), data), FRAME],
  ['hierarchical arithmetic SOF13', jpeg(sof(0xcd), sos(), data), FRAME],
  ['hierarchical arithmetic SOF14', jpeg(sof(0xce), sos(), data), FRAME],
  ['hierarchical arithmetic SOF15', jpeg(sof(0xcf), sos(), data), FRAME],
  ['a second frame', jpeg(sof(), sof(), sos(), data), FRAME],
  ['a frame with a 5-byte payload', jpeg(seg(0xc0, [8, 0, 2, 0, 3]), sos(), data), FRAME],
  ['12-bit precision', jpeg(sof(0xc0, { precision: 12 }), sos(), data), FRAME],
  ['2 components', jpeg(sof(0xc0, { ids: [1, 2] }), sos([1, 2]), data), FRAME],
  ['a frame one byte too long', jpeg(seg(0xc0, [8, 0, 2, 0, 3, 1, 1, 0x11, 0, 0]), sos([1]), data), FRAME],
  ['a repeated component id', jpeg(sof(0xc0, { ids: [1, 1, 2] }), sos([1, 2]), data), DUPLICATE_COMPONENT],
  ['a scan before the frame', jpeg(sos(), sof(), data), SCAN],
  ['a scan of no components', jpeg(sof(), sos([]), data), SCAN],
  ['a scan of 4 components in a frame of 3', jpeg(sof(), sos([1, 2, 3, 4]), data), SCAN],
  ['a scan one byte too long', jpeg(sof(), seg(0xda, [1, 1, 0, 0, 63, 0, 0]), data), SCAN],
  ['a component the frame lacks', jpeg(sof(), sos([1, 9]), data), SCAN_COMPONENT],
  ['a component repeated in a scan', jpeg(sof(), sos([2, 2]), data), SCAN_COMPONENT],
  ['an ICC payload of 13 bytes', ok(seg(0xe2, [...Buffer.from('ICC_PROFILE\0'), 1])), ICC_HEADER],
  ['ICC sequence 0', ok(icc(0, 1)), ICC_SEQUENCE],
  ['ICC total 0', ok(icc(1, 0)), ICC_SEQUENCE],
  ['an ICC sequence over its total', ok(icc(3, 2)), ICC_SEQUENCE],
  ['ICC totals that disagree', ok(icc(1, 2), icc(2, 3)), ICC_SEQUENCE],
  ['the same ICC chunk twice', ok(icc(1, 2), icc(1, 2)), ICC_DUPLICATE],
  ['ICC chunk 2 of 2 missing', ok(icc(1, 2)), ICC_MISSING],
  ['an RGB frame with a grey profile', ok(icc(1, 1, grayGammaProfile())), ICC_CHANNELS],
  [
    'a 4-component frame with an RGB profile',
    jpeg(sof(0xc0, { ids: [1, 2, 3, 4] }), icc(1, 1, adobeCompatibleProfile()), sos([1, 2, 3, 4]), data),
    ICC_CHANNELS,
  ],
  [
    'a grey frame with an RGB profile',
    jpeg(sof(0xc0, { ids: [1] }), icc(1, 1, adobeCompatibleProfile()), sos([1]), data),
    ICC_CHANNELS,
  ],
  ['invalid profile bytes', ok(icc(1, 1, [1, 2, 3])), PROFILE],
  ['a scan with no data', jpeg(sof(), sos()), NO_ENTROPY],
  ['a scan holding only a restart marker', jpeg(sof(), sos(), raw(0xff, 0xd0)), NO_ENTROPY],
  ['a scan that ends the file', jpeg(sof(), sos()).subarray(0, -2), NO_ENTROPY],
  ['a scan ending on a lone fill byte', Buffer.concat([ok().subarray(0, -2), raw(0xff)]), MARKER],
  ['a start marker straight after the data', jpeg(sof(), sos(), data, raw(0xff, 0xd8)), MARKER],
  ['no end marker', ok().subarray(0, -2), TRUNCATED],
  ['no scan', jpeg(sof()), TRUNCATED],
  ['no frame', jpeg(seg(0xe0)), TRUNCATED],
  // jpegSizeFromBuffer reads a segment after TEM, so the frame behind it isn't found.
  ['TEM before the frame', ok(raw(0xff, 0x01)), DIMENSIONS],
  ['width 0', jpeg(sof(0xc0, { width: 0 }), sos(), data), DIMENSIONS],
  ['height 0', jpeg(sof(0xc0, { height: 0 }), sos(), data), DIMENSIONS],
  // The first failure wins, because that's the message the user acts on.
  [
    'first failure wins: a second frame with repeated ids',
    jpeg(sof(), sof(0xc0, { ids: [1, 1, 2] }), sos(), data),
    FRAME,
  ],
  ['first failure wins: a bad scan, then a bad ICC chunk', jpeg(sof(), sos([9]), icc(0, 0), data), SCAN_COMPONENT],
  ['first failure wins: a bad ICC chunk, then a bad scan', jpeg(sof(), icc(0, 0), sos([9]), data), ICC_SEQUENCE],
  ['first failure wins: no scan, with a missing ICC chunk', jpeg(sof(), icc(1, 2)), TRUNCATED],
  ['first failure wins: no scan, with width 0', jpeg(sof(0xc0, { width: 0 })), TRUNCATED],
  [
    'first failure wins: width 0, with a missing ICC chunk',
    jpeg(sof(0xc0, { width: 0 }), icc(1, 2), sos(), data),
    DIMENSIONS,
  ],
  ['first failure wins: a missing ICC chunk, with a bad profile', ok(icc(2, 3, [1, 2, 3])), ICC_MISSING],
]) {
  test(`refuses ${name}`, () => {
    assert.throws(() => jpegInfo(file), { message })
  })
}

for (const [name, file, expected] of [
  ['the smallest whole file', ok(), plain],
  ['a marker below the frame range', ok(seg(0x02)), plain],
  ['a marker just below the frame range', ok(seg(0xbf)), plain],
  ['SOF0', jpeg(sof(0xc0), sos(), data), plain],
  ['SOF1', jpeg(sof(0xc1), sos(), data), plain],
  ['SOF2', jpeg(sof(0xc2), sos(), data), plain],
  ['SOF9', jpeg(sof(0xc9), sos(), data), plain],
  ['SOF10', jpeg(sof(0xca), sos(), data), plain],
  ['DHT, which sits among the frame markers', ok(seg(0xc4, [0, 0])), plain],
  ['JPG, which sits among the frame markers', ok(seg(0xc8, [0, 0])), plain],
  ['DAC, which sits among the frame markers', ok(seg(0xcc, [0, 0])), plain],
  [
    'TEM and restart markers after the frame',
    jpeg(sof(), raw(0xff, 0x01), raw(0xff, 0xd0), raw(0xff, 0xd7), sos(), data),
    plain,
  ],
  ['fill bytes before a marker', jpeg(sof(), raw(0xff, 0xff), sos(), data), plain],
  ['one component', jpeg(sof(0xc0, { ids: [1] }), sos([1]), data), { ...plain, components: 1 }],
  ['four components', jpeg(sof(0xc0, { ids: [1, 2, 3, 4] }), sos([1, 2, 3, 4]), data), { ...plain, components: 4 }],
  ['a scan of fewer components than the frame', jpeg(sof(), sos([1, 2]), data), plain],
  ['an APP2 that is not ICC', ok(seg(0xe2, [1, 2, 3])), plain],
  ['an APP2 with a short name', ok(seg(0xe2, [...Buffer.from('ICC_PROFILE')])), plain],
  ['another segment with an ICC name', ok(seg(0xe3, [...Buffer.from('ICC_PROFILE\0'), 0, 0])), plain],
  ['a stuffed zero as the only data', jpeg(sof(), sos(), raw(0xff, 0x00)), plain],
  ['a stuffed zero inside the data', jpeg(sof(), sos(), data, raw(0xff, 0x00), data), plain],
  ['data with restart markers inside', jpeg(sof(), sos(), data, raw(0xff, 0xd0), data, raw(0xff, 0xd7), data), plain],
  ['data ending on a restart marker', jpeg(sof(), sos(), data, raw(0xff, 0xd3)), plain],
  ['two scans', jpeg(sof(), sos([1]), data, sos([2, 3]), data), plain],
  ['a table between two scans', jpeg(sof(), sos([1]), data, seg(0xc4, [0, 0]), sos([2, 3]), data), plain],
  ['bytes after the end marker', Buffer.concat([ok(), raw(0, 0, 0)]), plain],
]) {
  test(`accepts ${name}`, () => {
    const info = jpegInfo(file)
    assert.deepEqual(info, expected)
    assert.deepEqual(Object.keys(info), ['width', 'height', 'components', 'profile'])
  })
}

test('ICC chunks that arrive out of order are joined in sequence', () => {
  const profile = adobeCompatibleProfile()
  const cut = 100
  const info = jpegInfo(ok(icc(2, 2, profile.subarray(cut)), icc(1, 2, profile.subarray(0, cut))))
  assert.deepEqual(info, { ...plain, profile })
})

test('an ICC chunk may hold no bytes', () => {
  const profile = adobeCompatibleProfile()
  assert.deepEqual(jpegInfo(ok(icc(1, 2), icc(2, 2, profile))), { ...plain, profile })
})

test('each frame size takes a matching profile', () => {
  const grey = jpeg(sof(0xc0, { ids: [1] }), icc(1, 1, grayGammaProfile()), sos([1]), data)
  assert.equal(jpegInfo(grey).components, 1)
  const cmyk = Buffer.from(adobeCompatibleProfile())
  cmyk.write('CMYK', 16)
  const four = jpeg(sof(0xc0, { ids: [1, 2, 3, 4] }), icc(1, 1, cmyk), sos([1, 2, 3, 4]), data)
  assert.deepEqual(jpegInfo(four), { ...plain, components: 4, profile: cmyk })
})
