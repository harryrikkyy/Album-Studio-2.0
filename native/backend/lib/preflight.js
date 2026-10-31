'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { collectFrames } = require('./psd_template')
const { coverQuad, embedScale } = require('./sheet')
const { placeableEvidence } = require('./raw')
const { fileDigest, contentKey, readVerifiedBuffer } = require('./cache')
const { spreadInputs } = require('./inputs')
const { printCanvas } = require('./print_settings')
const { readPsdBuffer } = require('./color')
const sharp = () => require('../../../src/sharp_config').getSharp()
/** @typedef {{ code: string, message: string, n?: number, id?: string, [detail: string]: unknown }} PreflightIssue */
let ag
function decoder() {
  if (!ag) {
    ag = require('ag-psd')
    ag.initializeCanvas((w, h) => ({
      width: w,
      height: h,
      // @ts-expect-error ag-psd's types want a full 2D context; it calls only createImageData here.
      getContext: () => ({
        createImageData: (a, b) => ({
          width: a,
          height: b,
          data: new Uint8ClampedArray(a * b * 4),
          colorSpace: /** @type {const} */ ('srgb'),
        }),
      }),
    }))
  }
  return ag
}
const finiteTree = (value) =>
  typeof value === 'number'
    ? Number.isFinite(value)
    : !value || typeof value !== 'object' || Object.values(value).every(finiteTree)
const exists = async (file) =>
  !!file &&
  (await fs.promises.stat(file).then(
    (s) => s.isFile(),
    () => false,
  ))

function invalidPrintSettings(settings, minimum) {
  return (
    !['print', 'original'].includes(settings.size) ||
    ![
      settings.ppi,
      settings.heightInches,
      minimum,
      settings.embeddingScale === undefined ? 1 : settings.embeddingScale,
    ].every((v) => Number.isFinite(v) && v > 0)
  )
}

function invalidSelection(album, requested) {
  return (
    !Array.isArray(requested) ||
    !requested.length ||
    new Set(requested).size !== requested.length ||
    requested.some((n) => !Number.isInteger(n) || !album.spreads.some((sp) => sp.n === n))
  )
}

function invalidLabSpec(spec) {
  return (
    !finiteTree(spec) ||
    ['widthInches', 'heightInches'].some((k) => !(spec[k] > 0)) ||
    ['bleedInches', 'safeInches', 'gutterInches'].some((k) => spec[k] !== undefined && spec[k] < 0)
  )
}

function checkLabSpec(spec, { add, fail }) {
  if (!spec) {
    add(
      'warnings',
      'lab_spec_unverified',
      'No print-lab specification is configured. Bleed, safe area, gutter and lab approval remain unverified.',
    )
    return
  }
  if (invalidLabSpec(spec)) fail('lab_spec_invalid', 'The configured lab specification contains invalid dimensions.')
  add(
    'warnings',
    'lab_layout_unverified',
    'The lab dimensions are checked; actual bleed, safe-area, gutter and printer colour compliance still require verification.',
  )
  if (spec.profile && !/^s-?rgb$/i.test(spec.profile))
    fail(
      'lab_profile_unsupported',
      'Delivery currently converts to sRGB. The configured lab profile needs a verified conversion workflow.',
    )
}

function conflictAffects(c, sp, ids) {
  if (c.n) return c.n === sp.n
  return (
    ids.has(c.id) ||
    (c.candidates || []).some((id) => ids.has(id)) ||
    (sp.template && (c.id === sp.template.id || (c.candidates || []).includes(sp.template.id)))
  )
}

function checkIdentityConflicts(sp, { album, fail }) {
  const ids = new Set(sp.photoIds)
  for (const c of album.identityConflicts || [])
    if (conflictAffects(c, sp, ids))
      fail(
        'identity_conflict',
        `Spread ${sp.n} has an ambiguous asset or adjustment. Resolve it before production.`,
        sp,
      )
}

/** Bytes a full decode of a template's geometry would take. */
function geometryBudget(outline) {
  let budget = outline.width * outline.height * 4
  const measure = (nodes) => {
    for (const n of nodes || []) {
      budget += Math.max(0, (n.right - n.left) * (n.bottom - n.top)) * 8
      measure(n.children)
    }
  }
  measure(outline.children)
  return budget
}

async function decodeTemplate(file, digest) {
  const bytes = await readPsdBuffer(file)
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== digest)
    throw new Error('The template changed before its verified geometry could be decoded.')
  const outline = decoder().readPsd(bytes, {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
  })
  const budget = geometryBudget(outline)
  if (!Number.isFinite(budget) || budget > 900 * 1024 * 1024)
    throw new Error('Template exceeds the full geometry-decode budget; its masks cannot be verified.')
  return decoder().readPsd(bytes, { skipCompositeImageData: true, skipThumbnail: true, useImageData: true })
}

/** The spread's decoded template, or null once its failure is reported. */
async function decodedTemplate(sp, inputValues, { templateCache, fail }) {
  try {
    const templateKey = contentKey(sp.template.file, inputValues[1])
    if (!templateCache.has(templateKey))
      templateCache.set(templateKey, await decodeTemplate(sp.template.file, inputValues[1]))
    const psd = templateCache.get(templateKey)
    if (![psd.width, psd.height].every((v) => Number.isFinite(v) && v > 0))
      throw new Error('Invalid template dimensions.')
    return psd
  } catch (e) {
    fail('template_corrupt', `Spread ${sp.n}: ${e.message}`, sp)
    return null
  }
}

function labDimensionsDiffer(spec, inches, psd) {
  return (
    spec &&
    [spec.widthInches, spec.heightInches].every((v) => v > 0) &&
    (Math.abs(inches - spec.heightInches) > 0.001 ||
      Math.abs((inches * psd.width) / psd.height - spec.widthInches) > 0.001)
  )
}

/** A template's frames, its layers by their ids in the editor, and those ids by layer. */
function layerModel(psd) {
  // A frame's `node` isn't enumerable, so the copy has to name it.
  const frames = collectFrames(psd.children).map((f) => ({ ...f, node: f.node }))
  const nodes = new Map(),
    nodeIds = new Map()
  const index = (list, prefix = '') =>
    (list || []).forEach((node, i) => {
      const id = prefix ? `${prefix}/${i}` : String(i)
      nodes.set(id, node)
      nodeIds.set(node, id)
      index(node.children, id)
    })
  index(psd.children)
  return { frames, nodes, nodeIds }
}

function invalidLayerEdit(edit) {
  return (
    !edit ||
    typeof edit !== 'object' ||
    !finiteTree(edit) ||
    ['sx', 'sy'].some((k) => edit[k] !== undefined && !(edit[k] > 0)) ||
    (edit.opacity !== undefined && !(edit.opacity >= 0 && edit.opacity <= 1)) ||
    (edit.hidden !== undefined && typeof edit.hidden !== 'boolean')
  )
}

function movesGroup(node, edit) {
  return (
    node.children && ['dx', 'dy', 'sx', 'sy'].some((k) => edit[k] !== undefined && edit[k] !== (k[0] === 's' ? 1 : 0))
  )
}

function applyFrameEdit(f, edit) {
  f.x += edit.dx || 0
  f.y += edit.dy || 0
  f.w *= edit.sx === undefined ? 1 : edit.sx
  f.h *= edit.sy === undefined ? 1 : edit.sy
  if (edit.hidden !== undefined) f.hidden = edit.hidden
  if (edit.opacity !== undefined) f.opacity = edit.opacity
}

function checkLayerEdits(sp, layerEdits, { frames, nodes }, { fail }) {
  for (const [id, edit] of Object.entries(layerEdits)) {
    if (invalidLayerEdit(edit)) {
      fail('layer_edit_invalid', `Spread ${sp.n} has an invalid layer edit.`, sp)
      continue
    }
    const node = nodes.get(id),
      f = frames.find((item) => item.node === node)
    if (!node) {
      fail('layer_geometry_unverified', `Spread ${sp.n} references a missing template layer.`, sp)
      continue
    }
    if (movesGroup(node, edit))
      fail('layer_geometry_unverified', `Spread ${sp.n}'s group transform needs verified mask geometry.`, sp)
    if (edit.textStyle && edit.textStyle.font)
      fail('unsupported_edit', `Spread ${sp.n}'s font override is not implemented in print sheets.`, sp)
    if (f) applyFrameEdit(f, edit)
  }
}

/** Recompute inherited visibility after overrides; showing a frame cannot reveal its hidden group. */
function inheritFrameState(f, layerEdits, { nodes, nodeIds }) {
  f.hidden = false
  f.opacity = 1
  const ids = nodeIds.get(f.node).split('/')
  for (let depth = 1; depth <= ids.length; depth++) {
    const id = ids.slice(0, depth).join('/'),
      node = nodes.get(id),
      edit = layerEdits[id] || {}
    f.hidden ||= edit.hidden === undefined ? !!node.hidden : !!edit.hidden
    f.opacity *= edit.opacity === undefined ? (node.opacity === undefined ? 1 : node.opacity) : edit.opacity
  }
}

/** The bounds of what shows through a layer's pixels and mask. With nothing showing, bx is below ax. */
function opaqueBounds(img, mask, { left, top, x0, y0, W, H }) {
  let ax = W,
    ay = H,
    bx = -1,
    by = -1
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let alpha = img ? img.data[(y * img.width + x) * 4 + 3] : 255
      if (mask && mask.imageData) {
        const mx = x + x0 - (mask.left || 0) - (mask.positionRelativeToLayer ? left : 0),
          my = y + y0 - (mask.top || 0) - (mask.positionRelativeToLayer ? top : 0),
          md = mask.imageData
        alpha *=
          mx >= 0 && my >= 0 && mx < md.width && my < md.height
            ? md.data[(my * md.width + mx) * 4] / 255
            : (mask.defaultColor || 0) / 255
      }
      if (alpha > 0) {
        ax = Math.min(ax, x)
        ay = Math.min(ay, y)
        bx = Math.max(bx, x)
        by = Math.max(by, y)
      }
    }
  return { ax, ay, bx, by }
}

/** Active alpha/mask bounds determine the real clipping area, including fill-layer frames. */
function checkFrame(sp, f, layerEdits, model, { fail }) {
  inheritFrameState(f, layerEdits, model)
  if (f.hidden || f.opacity <= 0) fail('frame_hidden', `Spread ${sp.n} has a hidden photo frame.`, sp)
  const node = f.node,
    img = node.imageData,
    mask = node.mask && !node.mask.disabled ? node.mask : null
  const left = node.left || 0,
    top = node.top || 0,
    w = node.right - left,
    h = node.bottom - top
  if (!img && !(mask && mask.imageData)) {
    fail('frame_geometry_unverified', `Spread ${sp.n}'s frame pixels and mask cannot be verified.`, sp)
    return
  }
  const x0 = w > 0 ? left : mask.left,
    y0 = h > 0 ? top : mask.top,
    W = w > 0 ? w : mask.right - mask.left,
    H = h > 0 ? h : mask.bottom - mask.top
  const { ax, ay, bx, by } = opaqueBounds(img, mask, { left, top, x0, y0, W, H })
  if (bx < ax || by < ay) {
    fail('frame_empty', `Spread ${sp.n} contains an empty photo frame.`, sp)
    return
  }
  const sx = f.w / W,
    sy = f.h / H
  f.x += ax * sx
  f.y += ay * sy
  f.w = (bx - ax + 1) * sx
  f.h = (by - ay + 1) * sy
}

function photoEdits(ws, id) {
  return {
    rotation: (ws.imageRotations || {})[id] === undefined ? 0 : ws.imageRotations[id],
    placement: (ws.imagePlacements || {})[id] || {},
    adjust: (ws.imageAdjustments || {})[id] || {},
  }
}

const NUMERIC_ADJUSTMENTS = [
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

function invalidPhotoEdit({ rotation, placement, adjust }) {
  return (
    !finiteTree({ rotation, placement, adjust }) ||
    typeof rotation !== 'number' ||
    ['scale', 'ox', 'oy'].some((k) => placement[k] !== undefined && typeof placement[k] !== 'number') ||
    NUMERIC_ADJUSTMENTS.some(
      (k) => adjust[k] !== undefined && (typeof adjust[k] !== 'number' || Math.abs(adjust[k]) > 100),
    ) ||
    (adjust.bw !== undefined && typeof adjust.bw !== 'boolean') ||
    (placement.scale !== undefined && !(placement.scale >= 1)) ||
    ['ox', 'oy'].some((k) => placement[k] !== undefined && Math.abs(placement[k]) > 1)
  )
}

function checkAdjustments(sp, adjust, { fail }) {
  if (Object.keys(adjust).some((k) => ![...NUMERIC_ADJUSTMENTS, 'bw'].includes(k) && adjust[k]))
    fail('unsupported_edit', `Spread ${sp.n} has a colour adjustment that the print renderer does not support.`, sp)
  if (adjust.vignette)
    fail('unsupported_edit', `Spread ${sp.n}'s vignette is preview-only and must be removed before printing.`, sp)
}

/** A photo's upright size, from a full decode of its verified revision. */
async function photoDimensions(photo, id, inputValues, { album, ws, photoCache }) {
  const expected = inputValues[2].find((v) => v[0] === id)
  if (!expected || expected[1] !== photo.original)
    throw new Error('The original no longer matches its verified print input.')
  const photoKey = contentKey(photo.original, expected[2])
  if (!photoCache.has(photoKey)) {
    const developed = await placeableEvidence(
      photo.original,
      path.join(ws.outputToken || path.join(album.path, 'exports'), '.album-studio', 'raw'),
    )
    if (developed.sourceKey !== photoKey)
      throw new Error('The original changed before its print metadata could be verified.')
    const input = await readVerifiedBuffer(developed.file, developed.digest)
    const pipeline = sharp()(input, { failOn: 'warning', limitInputPixels: 134217728 })
    const m = await pipeline.metadata()
    await pipeline.stats()
    const turn = [5, 6, 7, 8].includes(m.orientation)
    photoCache.set(photoKey, { w: turn ? m.height : m.width, h: turn ? m.width : m.height })
  }
  const meta = photoCache.get(photoKey)
  if (![meta.w, meta.h].every((v) => Number.isFinite(v) && v > 0)) throw new Error('Invalid source dimensions.')
  return meta
}

function reportResolution(sp, id, f, { meta, edit, transform }, { psd, inches, canvas }, check) {
  const { album, settings, minimum, add, fail } = check
  const photo = album.photos[id]
  const sourcePpi = psd.height / inches / transform.scale
  const embeddingScale = settings.embeddingScale === undefined ? canvas.scale : settings.embeddingScale
  const embeddedPpi =
    settings.phase === 'export'
      ? null
      : sourcePpi * embedScale({ w: f.w * embeddingScale, h: f.h * embeddingScale }, meta, edit)
  const effectivePpi = embeddedPpi === null ? sourcePpi : Math.min(sourcePpi, embeddedPpi)
  add('info', 'effective_ppi', `${photo.base || id}: ${effectivePpi.toFixed(1)} effective PPI.`, sp, {
    photoId: id,
    sourcePpi,
    embeddedPpi,
    effectivePpi,
  })
  if (effectivePpi + 1e-7 < minimum)
    fail(
      'low_effective_ppi',
      `Spread ${sp.n}: ${photo.base || id} is below the ${minimum} PPI policy (${effectivePpi.toFixed(1)}).`,
      sp,
    )
}

/** Whether the turned photo reaches all four of the frame's corners. */
function coversFrame(f, transform, meta, rotation) {
  const angle = (rotation * Math.PI) / 180,
    cos = Math.cos(angle),
    sin = Math.sin(angle),
    q = transform.quad
  const cx = (q[0][0] + q[2][0]) / 2,
    cy = (q[0][1] + q[2][1]) / 2
  return ![
    [f.x, f.y],
    [f.x + f.w, f.y],
    [f.x + f.w, f.y + f.h],
    [f.x, f.y + f.h],
  ].some(
    ([x, y]) =>
      Math.abs((x - cx) * cos + (y - cy) * sin) > (meta.w * transform.scale) / 2 + 0.01 ||
      Math.abs(-(x - cx) * sin + (y - cy) * cos) > (meta.h * transform.scale) / 2 + 0.01,
  )
}

async function checkPhotoPlacement(sp, id, f, page, check) {
  const { album, ws, fail } = check
  const photo = album.photos[id]
  if (!(await exists(photo.original))) {
    fail(
      'missing_original',
      `Spread ${sp.n}: original for ${photo.base || id} is missing; thumbnails cannot be printed.`,
      sp,
    )
    return
  }
  const edits = photoEdits(ws, id)
  if (invalidPhotoEdit(edits)) {
    fail('photo_edit_invalid', `Spread ${sp.n} has an invalid photo edit.`, sp)
    return
  }
  const { rotation, placement, adjust } = edits
  checkAdjustments(sp, adjust, check)
  let meta
  try {
    meta = await photoDimensions(photo, id, page.inputValues, check)
  } catch (e) {
    fail('photo_corrupt', `Spread ${sp.n}: ${photo.base || id} cannot be fully decoded (${e.message}).`, sp)
    return
  }
  const edit = { rotation, ...placement },
    transform = coverQuad(f, meta, edit)
  reportResolution(sp, id, f, { meta, edit, transform }, page, check)
  if (!coversFrame(f, transform, meta, rotation))
    fail('frame_coverage', `Spread ${sp.n}'s rotated photo does not cover all frame corners.`, sp)
}

async function checkOrientation(sp, orient, page, check) {
  const { album, fail } = check
  const photos = sp.photoIds.filter(
    (id) => album.photos[id] && (album.photos[id].orient === 'v' ? 'v' : 'h') === orient,
  )
  const matching = page.frames.filter((f) => f.orient === orient).sort((a, b) => a.name.localeCompare(b.name))
  if (photos.length > matching.length) fail('photo_unplaced', `Spread ${sp.n} has photos without matching frames.`, sp)
  if (photos.length < matching.length) fail('frame_unfilled', `Spread ${sp.n} has photo frames without photos.`, sp)
  for (let i = 0; i < Math.min(photos.length, matching.length); i++)
    await checkPhotoPlacement(sp, photos[i], matching[i], page, check)
}

async function verifyRevisions(sp, inputValues, { add, fail }) {
  try {
    if ((await fileDigest(sp.template.file)) !== inputValues[1]) throw new Error('the template changed')
    for (const [id, file, digest] of inputValues[2])
      if (file && (await fileDigest(file)) !== digest) throw new Error(`photo ${id} changed`)
    add(
      'info',
      'verified_input_revisions',
      'Template geometry and original photo metadata were decoded from the verified source revisions.',
      sp,
      { templateDigest: inputValues[1], photos: inputValues[2].map(([id, , digest]) => ({ id, digest })) },
    )
  } catch (error) {
    fail('source_changed', `Spread ${sp.n}'s print inputs changed during verification: ${error.message}`, sp)
  }
}

async function checkSpread(sp, check) {
  const { album, ws, settings, expectedInputs, spec, fail } = check
  let inputValues
  try {
    inputValues = (expectedInputs && expectedInputs.get(sp.n)) || (await spreadInputs(sp, album, ws))
  } catch (error) {
    fail('source_changed', `Spread ${sp.n}'s input revisions could not be verified: ${error.message}`, sp)
    return
  }
  checkIdentityConflicts(sp, check)
  if (!sp.template || !(await exists(sp.template.file))) {
    fail('template_missing', `Spread ${sp.n}'s template is missing.`, sp)
    return
  }
  const psd = await decodedTemplate(sp, inputValues, check)
  if (!psd) return
  const inches = settings.size === 'original' ? psd.height / settings.ppi : settings.heightInches
  let canvas
  try {
    canvas = printCanvas(psd.width, psd.height, settings)
  } catch (e) {
    fail('print_settings_invalid', e.message, sp)
    return
  }
  if (labDimensionsDiffer(spec, inches, psd))
    fail(
      'lab_dimensions_mismatch',
      `Spread ${sp.n}'s delivered dimensions differ from the configured lab dimensions.`,
      sp,
    )
  const model = layerModel(psd)
  const layerEdits = (ws.pageLayerEdits || {})[sp.n] || {}
  checkLayerEdits(sp, layerEdits, model, check)
  for (const f of model.frames) checkFrame(sp, f, layerEdits, model, check)
  const page = { frames: model.frames, psd, inches, canvas, inputValues }
  for (const orient of ['h', 'v']) await checkOrientation(sp, orient, page, check)
  for (const id of sp.photoIds)
    if (!album.photos[id]) fail('photo_missing', `Spread ${sp.n} references a missing photo (${id}).`, sp)
  await verifyRevisions(sp, inputValues, check)
}

/**
 * Full original decode and real PSD geometry. No lab compliance is inferred from defaults.
 * @param {number[] | null} [requestedSpreads]
 * @param {Map<number, Awaited<ReturnType<typeof spreadInputs>>> | null} [expectedInputs]
 */
async function preflightAlbum(album, ws, settings, requestedSpreads = null, expectedInputs = null) {
  /** @type {{ errors: PreflightIssue[], warnings: PreflightIssue[], info: PreflightIssue[] }} */
  const report = { errors: [], warnings: [], info: [] }
  const add = (kind, code, message, sp = {}, extra = {}) =>
    report[kind].push({ code, n: sp.n, id: sp.id, message, ...extra })
  const fail = (code, message, sp, extra) => add('errors', code, message, sp, extra)
  const minimum = settings.minEffectivePpi === undefined ? settings.ppi : settings.minEffectivePpi
  if (invalidPrintSettings(settings, minimum)) {
    fail('print_settings_invalid', 'Print size, resolution and minimum effective PPI must be finite positive numbers.')
    return report
  }
  add(
    'info',
    'effective_ppi_policy',
    settings.minEffectivePpi === undefined
      ? `Minimum effective PPI uses the configured output resolution (${settings.ppi} PPI).`
      : `Minimum effective PPI explicitly set to ${minimum}.`,
  )
  let selected = album.spreads
  if (requestedSpreads !== null) {
    if (invalidSelection(album, requestedSpreads)) {
      fail('spread_selection_invalid', 'Select existing spreads once each.')
      return report
    }
    selected = selected.filter((sp) => requestedSpreads.includes(sp.n))
  }
  const spec = ws.printSpec
  checkLabSpec(spec, { add, fail })
  const photoCache = new Map(),
    templateCache = new Map()
  const check = { album, ws, settings, expectedInputs, add, fail, minimum, spec, photoCache, templateCache }
  for (const sp of selected) await checkSpread(sp, check)
  if (settings.phase === 'export')
    add(
      'warnings',
      'embedded_resolution_unverified',
      'Original photo resolution is checked. Detail inside edited sheets still needs a visual check before printing.',
    )
  return report
}

module.exports = { preflightAlbum }
