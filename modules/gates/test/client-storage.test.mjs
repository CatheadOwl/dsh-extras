// Client-storage tests: the browser-side persistence for the gate switches
// (`lib/client/storage.js`). Node has no `window.localStorage`, so the test
// stubs it with an in-memory map — this is the one place the W8→W9 shape
// migration (bare id array → `{stop, manual}` dual lists) lives, and the only
// coverage that branch has. The storage module touches no other browser API,
// so the stub is complete.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loadDisabledTriggers, saveDisabledTriggers } from '../lib/client/storage.js'

const STORAGE_KEY = 'dsh.gates.disabled'

function withStorage(initial) {
  const store = new Map()
  if (initial !== undefined) store.set(STORAGE_KEY, initial)
  globalThis.window = {
    localStorage: {
      getItem: key => store.has(key) ? store.get(key) : null,
      setItem: (key, value) => { store.set(key, String(value)) },
    },
  }
  return store
}

test('a missing stored value loads as fully enabled (empty dual lists)', () => {
  withStorage()
  assert.deepEqual(loadDisabledTriggers(), { stop: [], manual: [] })
})

test('the W8 bare-id-array format migrates to both dimensions off', () => {
  withStorage(JSON.stringify(['doc-link', 'md-metadata']))
  assert.deepEqual(loadDisabledTriggers(), { stop: ['doc-link', 'md-metadata'], manual: ['doc-link', 'md-metadata'] })
})

test('the dual-list format loads as-is', () => {
  withStorage(JSON.stringify({ stop: ['doc-link'], manual: ['md-metadata'] }))
  assert.deepEqual(loadDisabledTriggers(), { stop: ['doc-link'], manual: ['md-metadata'] })
})

test('a partial dual list fills the missing dimension as empty', () => {
  withStorage(JSON.stringify({ stop: ['doc-link'] }))
  assert.deepEqual(loadDisabledTriggers(), { stop: ['doc-link'], manual: [] })
})

test('malformed stored values load as fully enabled (never crash the tab)', () => {
  for (const raw of ['not-json', 'null', '42', '{"stop": 7, "manual": {}}', '{"stop": [42], "manual": "x"}', '{}']) {
    withStorage(raw)
    assert.deepEqual(loadDisabledTriggers(), { stop: [], manual: [] }, `raw = ${raw}`)
  }
})

test('save then load round-trips the dual lists', () => {
  withStorage()
  saveDisabledTriggers({ stop: ['doc-link'], manual: ['md-metadata'] })
  assert.deepEqual(loadDisabledTriggers(), { stop: ['doc-link'], manual: ['md-metadata'] })
  saveDisabledTriggers({ stop: [], manual: [] })
  assert.deepEqual(loadDisabledTriggers(), { stop: [], manual: [] })
})

test('a throwing storage does not break save or load (private mode / quota)', () => {
  globalThis.window = {
    localStorage: {
      getItem: () => { throw new Error('storage denied') },
      setItem: () => { throw new Error('storage denied') },
    },
  }
  assert.deepEqual(loadDisabledTriggers(), { stop: [], manual: [] })
  assert.doesNotThrow(() => saveDisabledTriggers({ stop: ['doc-link'], manual: [] }))
})
