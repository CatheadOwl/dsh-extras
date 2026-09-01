import assert from 'node:assert/strict'
import { test } from 'node:test'

import { registerPromptMiddlewareProvider } from '../lib/register.js'

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
