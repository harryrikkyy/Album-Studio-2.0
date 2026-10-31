'use strict'

// Each rule validateProfile applies to a colour profile before an export trusts it: the message it
// gives, and the values just inside each limit. When a file breaks two rules, the earlier one wins,
// because that's the message the user reads.

const test = require('node:test')
const assert = require('node:assert/strict')
const { validateProfile } = require('../lib/color')
const { adobeCompatibleProfile } = require('./color_edge_fixtures')

const HEADER = 'The sheet has an invalid colour profile. Assign a valid profile in the editor before exporting.'
const TABLE = 'The sheet colour profile has an invalid tag table.'
const TAG = 'The sheet colour profile contains an invalid or truncated tag.'
const unsupported = (detail) =>
  `The sheet colour profile is invalid or unsupported (${detail}). Assign a valid source profile before exporting.`
const MATRIX = unsupported('invalid matrix or white point tag')
const SPACE = unsupported('invalid colour space, PCS or intent')

const good = adobeCompatibleProfile()
const changed = (change, base = good) => {
  const profile = Buffer.from(base)
  change(profile)
  return profile
}
const sized = (profile) => {
  profile.writeUInt32BE(profile.length)
  return profile
}
const entry = (i) => 132 + i * 12
const rXYZ = 3 // the fixture's tags: desc, cprt, wtpt, rXYZ, gXYZ, bXYZ, rTRC, gTRC, bTRC

/** A profile with chosen tags. Each tag is { signature, data }, with `offset` and `size` overriding the layout. */
function tagged(tags, { extra = 0 } = {}) {
  const tableEnd = 132 + tags.length * 12
  const bodies = tags.map((tag) => tag.data || Buffer.alloc(8))
  const length = bodies.reduce((total, body) => total + body.length, tableEnd) + extra
  const profile = Buffer.alloc(length)
  good.copy(profile, 0, 0, 128)
  profile.writeUInt32BE(length)
  profile.writeUInt32BE(tags.length, 128)
  let at = tableEnd
  tags.forEach((tag, i) => {
    profile.write(tag.signature, entry(i), 'ascii')
    profile.writeUInt32BE(tag.offset ?? at, entry(i) + 4)
    profile.writeUInt32BE(tag.size ?? bodies[i].length, entry(i) + 8)
    bodies[i].copy(profile, at)
    at += bodies[i].length
  })
  return profile
}

/** n tags that share the first body, each with its own signature. */
const many = (n) =>
  tagged(
    Array.from({ length: n }, (_, i) => ({ signature: String(i).padStart(4, '0'), offset: 132 + n * 12, size: 8 })),
  )

test('a valid profile comes back as the same buffer', () => {
  assert.equal(validateProfile(good), good)
})

for (const [name, profile, message] of [
  ['not a Buffer', new Uint8Array(good), HEADER],
  ['131 bytes', sized(Buffer.from(good.subarray(0, 131))), HEADER],
  ['132 bytes, with no room for its tags', sized(Buffer.from(good.subarray(0, 132))), TABLE],
  ['over the size limit', sized(Buffer.concat([good, Buffer.alloc(16 * 1024 * 1024 + 1 - good.length)])), HEADER],
  ['a declared length that differs', changed((p) => p.writeUInt32BE(p.length + 1)), HEADER],
  ['no signature', changed((p) => p.write('nope', 36)), HEADER],
  ['version 3', changed((p) => (p[8] = 3)), unsupported('unsupported ICC version')],
  ['version 0', changed((p) => (p[8] = 0)), unsupported('unsupported ICC version')],
  ['a device-link class', changed((p) => p.write('link', 12)), unsupported('not a source image profile')],
  ['an abstract class', changed((p) => p.write('abst', 12)), unsupported('not a source image profile')],
  ['colour space XYZ', changed((p) => p.write('XYZ ', 16)), SPACE],
  ['connection space RGB', changed((p) => p.write('RGB ', 20)), SPACE],
  ['intent 4', changed((p) => p.writeUInt32BE(4, 64)), SPACE],
  ['no tags', changed((p) => p.writeUInt32BE(0, 128)), TABLE],
  ['4097 tags', many(4097), TABLE],
  ['a tag table past the end', changed((p) => p.writeUInt32BE(Math.ceil((p.length - 132) / 12) + 1, 128)), TABLE],
  // A table that ends exactly at the end of the file is a valid table with nowhere to put its tag.
  ['a table ending at the end of the file', tagged([{ signature: 'desc', offset: 144, data: Buffer.alloc(0) }]), TAG],
  ['a repeated signature', changed((p) => p.write('desc', entry(1))), TAG],
  [
    'an offset off the four-byte grid',
    changed((p) => p.writeUInt32BE(p.readUInt32BE(entry(0) + 4) + 2, entry(0) + 4)),
    TAG,
  ],
  ['an offset of 134', changed((p) => p.writeUInt32BE(134, entry(0) + 4)), TAG],
  ['an offset inside the table', changed((p) => p.writeUInt32BE(136, entry(0) + 4)), TAG],
  ['the last offset inside the table', tagged([{ signature: 'desc', offset: 140 }]), TAG],
  ['size 7', changed((p) => p.writeUInt32BE(7, entry(0) + 8)), TAG],
  ['a size longer than the file', changed((p) => p.writeUInt32BE(p.length + 1, entry(0) + 8)), TAG],
  ['an offset past the end', changed((p) => p.writeUInt32BE(p.length + 4, entry(0) + 4)), TAG],
  ['a tag running one byte past the end', tagged([{ signature: 'desc', size: 9 }]), TAG],
  ['a matrix tag of 19 bytes', changed((p) => p.writeUInt32BE(19, entry(rXYZ) + 8)), MATRIX],
  ['a white point of type text', changed((p) => p.write('text', p.readUInt32BE(entry(2) + 4))), MATRIX],
  ['a green matrix of type text', changed((p) => p.write('text', p.readUInt32BE(entry(4) + 4))), MATRIX],
  ['a blue matrix of type text', changed((p) => p.write('text', p.readUInt32BE(entry(5) + 4))), MATRIX],
  [
    'a tone curve of an unknown type',
    changed((p) => p.write('nope', p.readUInt32BE(entry(6) + 4))),
    unsupported('unknown tone curve type'),
  ],
  [
    'a green curve of an unknown type',
    changed((p) => p.write('nope', p.readUInt32BE(entry(7) + 4))),
    unsupported('unknown tone curve type'),
  ],
  [
    'a blue curve of an unknown type',
    changed((p) => p.write('nope', p.readUInt32BE(entry(8) + 4))),
    unsupported('unknown tone curve type'),
  ],
  [
    'a grey curve of an unknown type',
    tagged([{ signature: 'kTRC', data: Buffer.from('nope\0\0\0\0\0\0\0\0') }]),
    unsupported('unknown tone curve type'),
  ],
  // The first failure wins, because that's the message the user acts on.
  [
    'first failure wins: a bad length and a bad version',
    changed((p) => (p.writeUInt32BE(p.length + 1), (p[8] = 3))),
    HEADER,
  ],
  [
    'first failure wins: a bad version and a bad class',
    changed((p) => ((p[8] = 3), p.write('link', 12))),
    unsupported('unsupported ICC version'),
  ],
  [
    'first failure wins: a bad class and a bad space',
    changed((p) => (p.write('link', 12), p.write('XYZ ', 16))),
    unsupported('not a source image profile'),
  ],
  [
    'first failure wins: a bad space and a bad count',
    changed((p) => (p.write('XYZ ', 16), p.writeUInt32BE(0, 128))),
    SPACE,
  ],
  [
    'first failure wins: a bad count and a bad tag',
    changed((p) => (p.writeUInt32BE(4097, 128), p.writeUInt32BE(7, entry(0) + 8))),
    TABLE,
  ],
  [
    'first failure wins: tags are checked in table order',
    changed((p) => (p.writeUInt32BE(7, entry(2) + 8), p.write('text', p.readUInt32BE(entry(rXYZ) + 4)))),
    TAG,
  ],
  [
    'first failure wins: a tag is checked before its contents',
    changed((p) => (p.write('rXYZ', entry(0)), p.writeUInt32BE(p.readUInt32BE(entry(0) + 4) + 2, entry(0) + 4))),
    TAG,
  ],
]) {
  test(`refuses ${name}`, () => {
    assert.throws(() => validateProfile(profile), { message })
  })
}

for (const [name, profile] of [
  ['version 4', changed((p) => (p[8] = 4))],
  ['each source class: scanner', changed((p) => p.write('scnr', 12))],
  ['each source class: printer', changed((p) => p.write('prtr', 12))],
  ['each source class: colour space', changed((p) => p.write('spac', 12))],
  ['each colour space: grey', changed((p) => p.write('GRAY', 16))],
  ['each colour space: CMYK', changed((p) => p.write('CMYK', 16))],
  ['each colour space: Lab', changed((p) => p.write('Lab ', 16))],
  ['connection space Lab', changed((p) => p.write('Lab ', 20))],
  ['intent 3', changed((p) => p.writeUInt32BE(3, 64))],
  ['exactly the size limit', sized(Buffer.concat([good, Buffer.alloc(16 * 1024 * 1024 - good.length)]))],
  ['one tag', tagged([{ signature: 'desc' }])],
  ['4096 tags', many(4096)],
  ['a tag at the first offset after the table', tagged([{ signature: 'desc', offset: 144, size: 8 }], { extra: 4 })],
  ['size 8', tagged([{ signature: 'desc', size: 8 }], { extra: 4 })],
  ['a tag ending exactly at the end', tagged([{ signature: 'desc', data: Buffer.alloc(12) }])],
  [
    'a matrix tag of exactly 20 bytes',
    tagged([{ signature: 'wtpt', data: Buffer.concat([Buffer.from('XYZ '), Buffer.alloc(16)]) }]),
  ],
]) {
  test(`accepts ${name}`, () => {
    assert.equal(validateProfile(profile), profile)
  })
}
