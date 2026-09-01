// Client-storage tests: the browser-side persistence for the provider switches
// (`lib/client/storage.js`). Node has no `window.localStorage`, so the test
// stubs it with an in-memory map — the storage module touches no other browser
// API, so the stub is complete.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loadDisabledProviderNames, saveDisabledProviderNames } from '../lib/client/storage.js'

const STORAGE_KEY = 'dsh.promptMiddleware.disabled'

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

test('a missing stored value loads as fully enabled (empty list)', () => {
  withStorage()
  assert.deepEqual(loadDisabledProviderNames(), [])
})

test('a valid name list loads as-is', () => {
  withStorage(JSON.stringify(['breadcrumb-description', 'cognition-link']))
  assert.deepEqual(loadDisabledProviderNames(), ['breadcrumb-description', 'cognition-link'])
})

test('malformed stored values load as empty (never crash the tab)', () => {
  for (const raw of ['not-json', 'null', '42', '{}', '{"ids": []}', '[42]', '["ok", 1]']) {
    withStorage(raw)
    assert.deepEqual(loadDisabledProviderNames(), [], `raw = ${raw}`)
  }
})

test('save then load round-trips the name list', () => {
  withStorage()
  saveDisabledProviderNames(['a', 'b'])
  assert.deepEqual(loadDisabledProviderNames(), ['a', 'b'])
  saveDisabledProviderNames([])
  assert.deepEqual(loadDisabledProviderNames(), [])
})

test('a throwing storage does not break save or load (private mode / quota)', () => {
  globalThis.window = {
    localStorage: {
      getItem: () => { throw new Error('storage denied') },
      setItem: () => { throw new Error('storage denied') },
    },
  }
  assert.deepEqual(loadDisabledProviderNames(), [])
  assert.doesNotThrow(() => saveDisabledProviderNames(['a']))
})
