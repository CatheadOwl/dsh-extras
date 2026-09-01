// Wire tests: the `promptMiddleware` remote surface driven through the REAL
// Typert Gateway, not the controller directly. The gateway's SRC discovery
// parses each Remote method's compiled signature (unique identifier parameters
// only, no defaults/destructuring/rest) and validates every invocation — the
// exact path the browser hits. These tests exist because direct controller
// calls cannot catch a signature the gateway rejects.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'

import * as promptMiddleware from '../lib/index.js'

function provider(overrides = {}) {
  return { name: 'demo-provider', run: async () => [], ...overrides }
}

async function wireHarness() {
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(TypertGatewayService)
  await ctx.plugin(promptMiddleware, {})
  return ctx
}

test('promptMiddleware/list resolves through the gateway with an omitted request', async () => {
  const ctx = await wireHarness()
  ctx.get('promptMiddleware').register(provider({ name: 't-provider', mode: 'always' }))

  const gateway = ctx.get('typertGateway')
  const list = await gateway.invoke({ namespace: 'promptMiddleware', method: 'list', args: {} })
  assert.equal(list.length, 1)
  assert.equal(list[0].name, 't-provider')
  assert.equal(list[0].enabled, true)
  assert.equal(list[0].mode, 'always')
  assert.equal(list[0].source, 'imperative')
})

test('promptMiddleware/setDisabled mirrors the list and answers the refreshed view', async () => {
  const ctx = await wireHarness()
  const service = ctx.get('promptMiddleware')
  service.register(provider({ name: 'a' }))
  service.register(provider({ name: 'b' }))

  const gateway = ctx.get('typertGateway')
  const after = await gateway.invoke({
    namespace: 'promptMiddleware',
    method: 'setDisabled',
    args: { request: { ids: ['a'] } },
  })
  assert.deepEqual(service.disabledIds(), ['a'])
  assert.equal(after.length, 2)
  assert.equal(after.find(view => view.name === 'a').enabled, false)
  assert.equal(after.find(view => view.name === 'b').enabled, true)
})

test('promptMiddleware/setDisabled rejects a malformed payload as bad-request', async () => {
  const ctx = await wireHarness()
  const gateway = ctx.get('typertGateway')
  await assert.rejects(
    () => gateway.invoke({ namespace: 'promptMiddleware', method: 'setDisabled', args: { request: 'nope' } }),
    (error) => error.code === 'gateway/bad-request',
  )
  await assert.rejects(
    () => gateway.invoke({ namespace: 'promptMiddleware', method: 'setDisabled', args: {} }),
    (error) => error.code === 'gateway/bad-request',
  )
  await assert.rejects(
    () => gateway.invoke({ namespace: 'promptMiddleware', method: 'setDisabled', args: { request: { ids: [42] } } }),
    (error) => error.code === 'gateway/bad-request',
  )
  await assert.rejects(
    () => gateway.invoke({ namespace: 'promptMiddleware', method: 'setDisabled', args: { request: { ids: 'nope' } } }),
    (error) => error.code === 'gateway/bad-request',
  )
})
