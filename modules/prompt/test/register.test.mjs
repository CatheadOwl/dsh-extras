import assert from 'node:assert/strict'
import { test } from 'node:test'

import { registerPromptMiddlewareProvider, registerRelatesProvider } from '../lib/register.js'

test('registerPromptMiddlewareProvider routes through ctx.inject', () => {
  let injected = false
  const provider = { name: 'demo', run: async () => [] }
  const ctx = {
    inject(deps, callback) {
      injected = true
      assert.deepEqual(deps, ['promptMiddleware'])
      return callback({ promptMiddleware: { register: () => () => {} } })
    },
  }
  registerPromptMiddlewareProvider(ctx, provider)
  assert.equal(injected, true)
})

test('registerRelatesProvider routes through ctx.inject and returns the disposer', () => {
  let injected = false
  const provider = { name: 'demo-relates', kind: 'demo', resolve: async () => undefined }
  const disposed = []
  const ctx = {
    inject(deps, callback) {
      injected = true
      assert.deepEqual(deps, ['promptMiddleware'])
      return callback({
        promptMiddleware: { registerRelates: () => () => disposed.push('demo-relates') },
      })
    },
  }
  registerRelatesProvider(ctx, provider)
  assert.equal(injected, true)
  assert.deepEqual(disposed, [])
})
