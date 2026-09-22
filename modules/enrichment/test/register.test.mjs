import assert from 'node:assert/strict'
import { test } from 'node:test'

import { registerEnrichmentProvider, registerRelatesProvider } from '../lib/register.js'

test('registerEnrichmentProvider routes through ctx.inject', () => {
  let injected = false
  const provider = { name: 'demo', run: async () => [] }
  const ctx = {
    inject(deps, callback) {
      injected = true
      assert.deepEqual(deps, ['enrichment'])
      return callback({ enrichment: { register: () => () => {} } })
    },
  }
  registerEnrichmentProvider(ctx, provider)
  assert.equal(injected, true)
})

test('registerRelatesProvider routes through ctx.inject and returns the disposer', () => {
  let injected = false
  const provider = { name: 'demo-relates', kind: 'demo', resolve: async () => undefined }
  const disposed = []
  const ctx = {
    inject(deps, callback) {
      injected = true
      assert.deepEqual(deps, ['enrichment'])
      return callback({
        enrichment: { registerRelates: () => () => disposed.push('demo-relates') },
      })
    },
  }
  registerRelatesProvider(ctx, provider)
  assert.equal(injected, true)
  assert.deepEqual(disposed, [])
})
