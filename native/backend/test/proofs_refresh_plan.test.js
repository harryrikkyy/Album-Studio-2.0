'use strict'

// What a refresh decides for each spread before it draws anything: what to draw, what to carry
// over from another proof and what to remove. The album, inputs and sheet records are stubbed;
// the manifest and proof files are real. A spread's stubbed input is its hash, so a row's hashes
// are the literals it names.

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const { tmpdir } = require('./fixtures')
const inputs = require('../lib/inputs')
const { loadPrivate } = require('./load_private')

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex')

// What the stubs answer for the row running now.
let row

const {
  __private: { prepareRefresh },
} = loadPrivate('../lib/proofs.js', {
  names: ['prepareRefresh'],
  stubs: {
    './album': {
      openAlbum: async (given, options) => {
        row.opened = [given, options]
        return row.album
      },
    },
    './inputs': {
      ...inputs,
      spreadInputs: async (s) => s.hash,
      hashInputValues: (_, value) => value,
    },
    './output_paths': {
      validateProofPaths: async (dir) => {
        row.validated.push(dir)
      },
    },
    './sheets': {
      ownedSheetRecord: async (ws, dir, id) => {
        row.asked.push([ws, dir, id])
        return row.records[id]
      },
      verifiedSheetRecord: (record) => !!record && record.verified === true,
    },
    './render_inputs': {
      spreadHash: async (s) => `sheet hash ${s.n}`,
    },
  },
})

/** An album folder holding spreads' proof files and sheets, and the manifest a row gives it. */
function folder() {
  const dir = tmpdir()
  const pages = path.join(dir, 'proofs', 'pages')
  fs.mkdirSync(pages, { recursive: true })
  const file = (name, text) => {
    const at = path.join(dir, name)
    fs.writeFileSync(at, text)
    return at
  }
  const proofOf = (n) => path.join(pages, `live_page_${String(n).padStart(3, '0')}.jpg`)
  return {
    dir,
    file,
    proofOf,
    proof: (n, text) => {
      fs.writeFileSync(proofOf(n), text)
      return sha(text)
    },
    /** Runs prepareRefresh, and shows a todo as { n, remove, hash, fromSheet, sheetDigest }. */
    async plan(spreads, manifest, { records = {}, targets, project = { workspace: { w: 1 } } } = {}) {
      fs.writeFileSync(path.join(pages, '.album-studio-proofs.json'), JSON.stringify({ version: 1, spreads: manifest }))
      row = { album: { path: dir, spreads }, records, validated: [], asked: [] }
      const text = JSON.stringify(project)
      const result = await prepareRefresh(path.join(dir, 'project.json'), text, targets)
      const todo = result.todo.map(({ s, remove, hash, fromSheet, sheetDigest }) => {
        const shown = { n: s.n }
        if (remove !== undefined) shown.remove = remove
        if (hash !== undefined) shown.hash = hash
        if (fromSheet !== undefined) shown.fromSheet = fromSheet
        if (sheetDigest !== undefined) shown.sheetDigest = sheetDigest
        return shown
      })
      return { todo, reuse: [...result.reuse.keys()], removed: result.removed, result }
    },
  }
}

const spread = (n, extra) => ({ n, id: `id${n}`, hash: `h${n}`, template: { file: 'page.psd' }, ...extra })
const entry = (n, digest, extra) => ({ id: `id${n}`, hash: `h${n}`, digest, ...extra })

// ── the manifest ────────────────────────────────────────────────────────────

test('a null manifest entry is ignored', async () => {
  const a = folder()
  const { todo, reuse } = await a.plan([spread(1)], { 2: null })
  assert.deepEqual(todo, [{ n: 1, hash: 'h1' }])
  assert.deepEqual(reuse, [])
})

test("a null entry at a spread's own number counts as no entry", async () => {
  const a = folder()
  const { todo } = await a.plan([spread(1)], { 1: null })
  assert.deepEqual(todo, [{ n: 1, hash: 'h1' }])
})

test('an entry with no hash lends nothing, even to an emptied spread with its id', async () => {
  const a = folder()
  const digest = a.proof(2, 'picture')
  const { todo, reuse } = await a.plan([spread(1, { template: null })], {
    1: entry(1, 'd', { id: 'other' }),
    2: { id: 'id1', digest },
  })
  assert.deepEqual(todo, [{ n: 1, remove: true }])
  assert.deepEqual(reuse, [])
})

test('an entry with no id is not found by a spread with no id', async () => {
  const a = folder()
  const digest = a.proof(2, 'picture')
  const { reuse } = await a.plan([spread(1, { id: undefined, hash: 'same' })], {
    2: { hash: 'same', digest, source: 'sheet' },
  })
  assert.deepEqual(reuse, [])
})

test('the manifest and proof folders are validated before the project is read', async () => {
  const a = folder()
  await a.plan([], {})
  assert.deepEqual(row.validated, [a.dir, a.dir])
})

test('the album opens from the given text, and the workspace is its own key', async () => {
  const a = folder()
  const { result } = await a.plan([], {}, { project: { workspace: { w: 1 }, other: 2 } })
  assert.deepEqual(row.opened, [
    { path: path.join(a.dir, 'project.json') },
    { data: { workspace: { w: 1 }, other: 2 } },
  ])
  assert.deepEqual(result.ws, { w: 1 })
  assert.equal(result.projectText, '{"workspace":{"w":1},"other":2}')
  assert.equal(result.album, row.album)
})

test('a project with no workspace key is its own workspace', async () => {
  const a = folder()
  const { result } = await a.plan([], {}, { project: { w: 2 } })
  assert.deepEqual(result.ws, { w: 2 })
})

test('targets limit the plan to those spreads', async () => {
  const a = folder()
  const { todo } = await a.plan([spread(1), spread(2)], {}, { targets: new Set([2]) })
  assert.deepEqual(todo, [{ n: 2, hash: 'h2' }])
})

test('with no targets every spread is planned', async () => {
  const a = folder()
  const { todo } = await a.plan([spread(1), spread(2)], {})
  assert.deepEqual(todo, [
    { n: 1, hash: 'h1' },
    { n: 2, hash: 'h2' },
  ])
})

// ── what to draw ────────────────────────────────────────────────────────────

test('an emptied spread with an entry loses its picture', async () => {
  const a = folder()
  const { todo } = await a.plan([spread(1, { template: null })], { 1: entry(1, 'd') })
  assert.deepEqual(todo, [{ n: 1, remove: true }])
})

test('an emptied spread still pointing at its proof file loses it', async () => {
  const a = folder()
  const { todo } = await a.plan([spread(1, { template: null, proof: a.proofOf(1) })], {})
  assert.deepEqual(todo, [{ n: 1, remove: true }])
})

test('an emptied spread with neither has nothing to do', async () => {
  const a = folder()
  const { todo } = await a.plan([spread(1, { template: null, proof: '/elsewhere.jpg' })], {})
  assert.deepEqual(todo, [])
})

test('a current picture stays', async () => {
  const a = folder()
  const { todo } = await a.plan([spread(1)], { 1: entry(1, a.proof(1, 'picture')) })
  assert.deepEqual(todo, [])
})

test('a current entry with no id, not from a sheet, stays', async () => {
  const a = folder()
  const { todo } = await a.plan([spread(1)], { 1: entry(1, a.proof(1, 'picture'), { id: undefined }) })
  assert.deepEqual(todo, [])
})

test('a current entry with no id, from a sheet, is drawn again', async () => {
  const a = folder()
  const { todo } = await a.plan([spread(1)], { 1: entry(1, a.proof(1, 'picture'), { id: undefined, source: 'sheet' }) })
  assert.deepEqual(todo, [{ n: 1, hash: 'h1' }])
})

test("an entry for another spread's id is drawn again", async () => {
  const a = folder()
  const { todo } = await a.plan([spread(1)], { 1: entry(1, a.proof(1, 'picture'), { id: 'another' }) })
  assert.deepEqual(todo, [{ n: 1, hash: 'h1' }])
})

test('a current entry with no digest is drawn again', async () => {
  const a = folder()
  a.proof(1, 'picture')
  const { todo } = await a.plan([spread(1)], { 1: entry(1, undefined) })
  assert.deepEqual(todo, [{ n: 1, hash: 'h1' }])
})

test('a picture whose bytes changed is drawn again', async () => {
  const a = folder()
  a.proof(1, 'edited')
  const { todo } = await a.plan([spread(1)], { 1: entry(1, sha('picture')) })
  assert.deepEqual(todo, [{ n: 1, hash: 'h1' }])
})

test('a changed sheet proof is redrawn from its sheet', async () => {
  const a = folder()
  const sheet = a.file('sheet.psd', 'sheet bytes')
  a.proof(1, 'edited')
  const { todo } = await a.plan([spread(1, { sheet })], { 1: entry(1, sha('picture'), { source: 'sheet' }) })
  assert.deepEqual(todo, [{ n: 1, hash: 'h1', fromSheet: sheet, sheetDigest: sha('sheet bytes') }])
})

test('a changed sheet proof with no sheet left is drawn from the template', async () => {
  const a = folder()
  a.proof(1, 'edited')
  const { todo } = await a.plan([spread(1)], { 1: entry(1, sha('picture'), { source: 'sheet' }) })
  assert.deepEqual(todo, [{ n: 1, hash: 'h1' }])
})

test('a changed picture that was not from a sheet ignores the sheet', async () => {
  const a = folder()
  const sheet = a.file('sheet.psd', 'sheet bytes')
  a.proof(1, 'edited')
  const { todo } = await a.plan([spread(1, { sheet })], { 1: entry(1, sha('picture')) })
  assert.deepEqual(
    todo.map((t) => t.fromSheet),
    [undefined],
  )
})

const sheetProof = (a, sheet, extra) =>
  entry(1, a.proof(1, 'picture'), { source: 'sheet', sheetPath: sheet, sheetDigest: sha('sheet bytes'), ...extra })

test('a sheet saved since its proof was made redraws it', async () => {
  const a = folder()
  const sheet = a.file('sheet.psd', 'saved again')
  const { todo } = await a.plan([spread(1, { sheet })], { 1: sheetProof(a, sheet) })
  assert.deepEqual(todo, [{ n: 1, hash: 'h1', fromSheet: sheet, sheetDigest: sha('saved again') }])
})

test('a sheet that moved redraws its proof', async () => {
  const a = folder()
  const sheet = a.file('sheet.psd', 'sheet bytes')
  const { todo } = await a.plan([spread(1, { sheet })], { 1: sheetProof(a, '/old/sheet.psd') })
  assert.deepEqual(todo, [{ n: 1, hash: 'h1', fromSheet: sheet, sheetDigest: sha('sheet bytes') }])
})

test('a sheet just as its proof saw it changes nothing', async () => {
  const a = folder()
  const sheet = a.file('sheet.psd', 'sheet bytes')
  const { todo } = await a.plan([spread(1, { sheet })], { 1: sheetProof(a, sheet) })
  assert.deepEqual(todo, [])
})

test('a current sheet proof whose spread has no sheet stays', async () => {
  const a = folder()
  const { todo } = await a.plan([spread(1)], { 1: sheetProof(a, '/old/sheet.psd') })
  assert.deepEqual(todo, [])
})

test('a spread that changed is drawn', async () => {
  const a = folder()
  const { todo } = await a.plan([spread(1)], { 1: entry(1, a.proof(1, 'picture'), { hash: 'older' }) })
  assert.deepEqual(todo, [{ n: 1, hash: 'h1' }])
})

test('a template that is not on disk keeps whatever picture there is', async () => {
  const a = folder()
  const { todo } = await a.plan([spread(1, { template: {} })], {
    1: entry(1, a.proof(1, 'picture'), { hash: 'older' }),
  })
  assert.deepEqual(todo, [])
})

// ── what to carry over ──────────────────────────────────────────────────────

test('a spread that moved takes its picture with it, by id', async () => {
  const a = folder()
  const digest = a.proof(1, 'picture')
  const { todo, reuse, result } = await a.plan([spread(2, { id: 'id1', hash: 'h1' })], { 1: entry(1, digest) })
  assert.deepEqual(todo, [{ n: 2, hash: 'h1' }])
  assert.deepEqual(reuse, [2])
  assert.deepEqual(result.reuse.get(2), {
    buf: Buffer.from('picture'),
    source: undefined,
    sheetDigest: undefined,
    sheetPath: undefined,
  })
})

test('a spread showing the same picture as another takes it, by hash', async () => {
  const a = folder()
  const digest = a.proof(1, 'picture')
  const { reuse } = await a.plan([spread(2, { hash: 'h1' })], { 1: entry(1, digest) })
  assert.deepEqual(reuse, [2])
})

test('the first picture with a hash is the one found', async () => {
  const a = folder()
  const digest = a.proof(1, 'picture')
  a.proof(2, 'another')
  const { reuse, result } = await a.plan([spread(3, { hash: 'same' })], {
    1: entry(1, digest, { hash: 'same' }),
    2: entry(2, sha('another'), { hash: 'same' }),
  })
  assert.deepEqual(reuse, [3])
  assert.deepEqual(result.reuse.get(3).buf, Buffer.from('picture'))
})

test('a sheet proof is not found by hash', async () => {
  const a = folder()
  const digest = a.proof(1, 'picture')
  const { reuse } = await a.plan([spread(2, { hash: 'h1' })], { 1: entry(1, digest, { source: 'sheet' }) })
  assert.deepEqual(reuse, [])
})

test("when the id's picture shows something else, the hash decides", async () => {
  const a = folder()
  a.proof(1, 'old look')
  const digest = a.proof(3, 'picture')
  const { reuse, result } = await a.plan([spread(2, { id: 'id1', hash: 'h3' })], {
    1: entry(1, sha('old look'), { hash: 'older' }),
    3: entry(3, digest),
  })
  assert.deepEqual(reuse, [2])
  assert.deepEqual(result.reuse.get(2).buf, Buffer.from('picture'))
})

test("an id's picture with the same hash wins over a hash match elsewhere", async () => {
  const a = folder()
  a.proof(1, 'found by hash')
  const digest = a.proof(3, 'found by id')
  const { result } = await a.plan([spread(2, { id: 'id3', hash: 'same' })], {
    1: entry(1, sha('found by hash'), { hash: 'same' }),
    3: entry(3, digest, { hash: 'same' }),
  })
  assert.deepEqual(result.reuse.get(2).buf, Buffer.from('found by id'))
})

const movedSheet = (a, sheetPath, sheetDigest) =>
  entry(1, a.proof(1, 'picture'), { source: 'sheet', sheetPath, sheetDigest })

test("a sheet proof found by id, its sheet elsewhere, redraws from this spread's sheet", async () => {
  const a = folder()
  const sheet = a.file('sheet.psd', 'sheet bytes')
  const { todo, reuse } = await a.plan([spread(2, { id: 'id1', hash: 'h1', sheet })], {
    1: movedSheet(a, '/other/sheet.psd', sha('sheet bytes')),
  })
  assert.deepEqual(todo, [{ n: 2, hash: 'h1', fromSheet: sheet, sheetDigest: sha('sheet bytes') }])
  assert.deepEqual(reuse, [])
})

test('a sheet proof found by id, this spread having no sheet, is drawn plainly', async () => {
  const a = folder()
  const { todo, reuse } = await a.plan([spread(2, { id: 'id1', hash: 'h1' })], {
    1: movedSheet(a, '/other/sheet.psd', sha('sheet bytes')),
  })
  assert.deepEqual(todo, [{ n: 2, hash: 'h1' }])
  assert.deepEqual(reuse, [])
})

test('a sheet proof found by id, its sheet edited, redraws from it', async () => {
  const a = folder()
  const sheet = a.file('sheet.psd', 'saved again')
  const { todo, reuse } = await a.plan([spread(2, { id: 'id1', hash: 'h1', sheet })], {
    1: movedSheet(a, sheet, sha('sheet bytes')),
  })
  assert.deepEqual(todo, [{ n: 2, hash: 'h1', fromSheet: sheet, sheetDigest: sha('saved again') }])
  assert.deepEqual(reuse, [])
})

test('a sheet proof found by id, its sheet the same, moves with its record', async () => {
  const a = folder()
  const sheet = a.file('sheet.psd', 'sheet bytes')
  const { todo, reuse, result } = await a.plan([spread(2, { id: 'id1', hash: 'h1', sheet })], {
    1: movedSheet(a, sheet, sha('sheet bytes')),
  })
  assert.deepEqual(todo, [{ n: 2, hash: 'h1' }])
  assert.deepEqual(reuse, [2])
  assert.deepEqual(result.reuse.get(2), {
    buf: Buffer.from('picture'),
    source: 'sheet',
    sheetDigest: sha('sheet bytes'),
    sheetPath: sheet,
  })
})

test('a picture whose file is gone is not carried over', async () => {
  const a = folder()
  const { reuse } = await a.plan([spread(2, { hash: 'h1' })], { 1: entry(1, sha('picture')) })
  assert.deepEqual(reuse, [])
})

test('a picture whose bytes do not match its record is not carried over', async () => {
  const a = folder()
  a.proof(1, 'edited')
  const { reuse } = await a.plan([spread(2, { hash: 'h1' })], { 1: entry(1, sha('picture')) })
  assert.deepEqual(reuse, [])
})

test('a spread found only in its own entry is not its own source, and looks to its sheet', async () => {
  const a = folder()
  const sheet = a.file('sheet.psd', 'sheet bytes')
  a.proof(1, 'edited')
  const { todo, reuse } = await a.plan(
    [spread(1, { sheet })],
    { 1: entry(1, sha('picture')) },
    {
      records: { id1: { verified: true, hash: 'sheet hash 1' } },
    },
  )
  assert.deepEqual(todo, [{ n: 1, hash: 'h1', fromSheet: sheet, sheetDigest: sha('sheet bytes') }])
  assert.deepEqual(reuse, [])
  assert.deepEqual(row.asked, [[{ w: 1 }, a.dir, 'id1']])
})

test('a spread with no sheet is not looked up', async () => {
  const a = folder()
  await a.plan([spread(1)], {})
  assert.deepEqual(row.asked, [])
})

test('a verified sheet that matches the spread draws from the sheet', async () => {
  const a = folder()
  const sheet = a.file('sheet.psd', 'sheet bytes')
  const { todo } = await a.plan(
    [spread(1, { sheet })],
    {},
    {
      records: { id1: { verified: true, hash: 'sheet hash 1' } },
    },
  )
  assert.deepEqual(todo, [{ n: 1, hash: 'h1', fromSheet: sheet, sheetDigest: sha('sheet bytes') }])
})

test('an unverified sheet is not used', async () => {
  const a = folder()
  const sheet = a.file('sheet.psd', 'sheet bytes')
  const { todo } = await a.plan(
    [spread(1, { sheet })],
    {},
    {
      records: { id1: { verified: false, hash: 'sheet hash 1' } },
    },
  )
  assert.deepEqual(todo, [{ n: 1, hash: 'h1' }])
})

test('a sheet made for another version of the spread is not used', async () => {
  const a = folder()
  const sheet = a.file('sheet.psd', 'sheet bytes')
  const { todo } = await a.plan(
    [spread(1, { sheet })],
    {},
    {
      records: { id1: { verified: true, hash: 'older' } },
    },
  )
  assert.deepEqual(todo, [{ n: 1, hash: 'h1' }])
})

// ── what is left over ───────────────────────────────────────────────────────

test("entries past the album's end are removed, and the last page stays", async () => {
  const a = folder()
  const { removed } = await a.plan([spread(1), spread(2)], {
    1: entry(1, 'd'),
    2: entry(2, 'd'),
    3: entry(3, 'd'),
    7: null,
  })
  assert.deepEqual(removed, [3, 7])
})

test('each todo carries its inputs and the entry it replaces', async () => {
  const a = folder()
  const { result } = await a.plan([spread(1), spread(2)], { 1: entry(1, 'd', { hash: 'older' }) })
  assert.deepEqual(
    result.todo.map((t) => [t.inputs, t.previous]),
    [
      ['h1', '{"id":"id1","hash":"older","digest":"d"}'],
      ['h2', undefined],
    ],
  )
})
