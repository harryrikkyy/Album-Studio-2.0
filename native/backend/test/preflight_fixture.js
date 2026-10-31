'use strict'

// A small real album for preflight's tests: one photo, one template with one frame, one spread.

const fs = require('fs')
const os = require('os')
const path = require('path')
const ag = require('ag-psd')
const sharp = require('../../../src/sharp_config').getSharp()
const { preflightAlbum } = require('../lib/preflight')

ag.initializeCanvas((w, h) => ({
  width: w,
  height: h,
  getContext: () => ({ createImageData: (a, b) => ({ width: a, height: b, data: new Uint8ClampedArray(a * b * 4) }) }),
}))

function pixels(w, h, alpha = 255) {
  const data = new Uint8ClampedArray(w * h * 4).fill(180)
  for (let i = 3; i < data.length; i += 4) data[i] = alpha
  return { width: w, height: h, data }
}

function frame(name = 'ToolkitHFrame_001', { x = 100, y = 50, w = 400, h = 300, ...extra } = {}) {
  return { name, left: x, top: y, right: x + w, bottom: y + h, imageData: pixels(w, h), ...extra }
}

async function fixture(t, { width = 800, height = 600, frames = [frame()], canvasW = 800, canvasH = 400 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'as-preflight-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const original = path.join(root, 'original.jpg')
  const thumb = path.join(root, 'thumbnail.jpg')
  await sharp({ create: { width, height, channels: 3, background: '#986543' } })
    .jpeg()
    .toFile(original)
  await sharp(original).resize(80, 60, { fit: 'inside' }).jpeg().toFile(thumb)
  const template = path.join(root, 'template.psd')
  fs.writeFileSync(
    template,
    ag.writePsdBuffer({ width: canvasW, height: canvasH, imageData: pixels(canvasW, canvasH), children: frames }),
  )
  const album = {
    path: root,
    photos: { photoA: { id: 'photoA', base: 'Original', original, thumb, width: 80, height: 60, orient: 'h' } },
    spreads: [
      { n: 1, id: 'spread_1', photoIds: ['photoA'], template: { id: 'templateA', name: 'Template', file: template } },
    ],
    identityConflicts: [],
  }
  const workspace = {
    outputToken: path.join(root, 'output'),
    imageRotations: {},
    imagePlacements: {},
    imageAdjustments: {},
    pageLayerEdits: {},
  }
  return {
    root,
    original,
    thumb,
    template,
    album,
    workspace,
    settings: { size: 'print', heightInches: 1, ppi: 300, phase: 'render' },
  }
}

const codes = (report) => report.errors.map((e) => e.code)
const run = (f, settings = {}, selected = null) =>
  preflightAlbum(f.album, f.workspace, { ...f.settings, ...settings }, selected)

module.exports = { pixels, frame, fixture, codes, run }
