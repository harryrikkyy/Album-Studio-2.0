'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { loadPrivate } = require('./load_private')

test('a private function comes back under __private', () => {
  const { __private } = loadPrivate('../lib/parity.js', { names: ['agBox'] })
  assert.deepEqual(__private.agBox({ left: 1, top: 2, right: 5, bottom: 6 }), { x: 1, y: 2, w: 4, h: 4 })
})

test('a stub replaces a collaborator the module destructures at load', async () => {
  const calls = []
  const { __private } = loadPrivate('../lib/deliver.js', {
    names: ['runExport'],
    stubs: {
      fs: {
        promises: {
          mkdir: async () => {
            calls.push('mkdir')
            throw new Error('no folder')
          },
        },
      },
      './jobs': { ...require('../lib/jobs'), releaseJob: async () => calls.push('release') },
    },
  })
  const job = { id: 'j', total: 0, done: 0, skipped: 0, failed: 0, cancelled: false, finishingErrors: [] }
  const prepared = {
    p: {},
    plan: { spreads: [] },
    cache: { spreads: {} },
    spreads: [],
    want: {},
    s: {},
    paths: { sheets: '/x' },
  }
  await __private.runExport(job, prepared, () => {})
  assert.deepEqual(calls, ['mkdir', 'release'])
  assert.equal(job.failed, 1)
})

test('each load is a fresh copy', () => {
  const a = loadPrivate('../lib/parity.js', { names: ['agBox'] })
  const b = loadPrivate('../lib/parity.js', { names: ['agBox'] })
  assert.notEqual(a.__private.agBox, b.__private.agBox)
})
