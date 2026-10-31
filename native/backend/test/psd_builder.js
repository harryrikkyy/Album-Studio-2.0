'use strict'

// PSD and PSB documents built section by section, so a test controls one field at a time.

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

module.exports = { block, layerSection, len, merged, psd, rawResource, resource, u16, u32 }
