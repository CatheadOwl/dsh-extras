// Wire tests: the `gates` remote surface driven through the REAL Typert
// Gateway, not the controller directly. The gateway's SRC discovery parses
// each Remote method's compiled signature (unique identifier parameters only,
// no defaults/destructuring/rest) and validates every invocation — the exact
// path the browser hits. These tests exist because direct controller calls
// cannot catch a signature the gateway rejects.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import ToolRuntime from '@deepseek-ai/dsh-tools'

import * as gates from '../lib/index.js'

const testRoot = mkdtempSync(join(tmpdir(), 'gates-wire-tests-'))
test.after(() => rmSync(testRoot, { recursive: true, force: true }))

function gate(overrides) {
  return {
    id: 't-gate',
    description: 'wire test gate',
    rationale: 'wire rationale',
    on: ['stop', 'manual'],
    level: 'blocking',
    check: async () => [],
    ...overrides,
  }
}

async function wireHarness() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(TypertGatewayService)
  await ctx.plugin(gates, {})
  return ctx
}

test('gates/list resolves through the gateway with a workspace request (SRC discovery)', async () => {
  const ctx = await wireHarness()
  ctx.get('gates').register(gate())

  const gateway = ctx.get('typertGateway')
  const list = await gateway.invoke({ namespace: 'gates', method: 'list', args: { request: { workspace: testRoot } } })
  assert.equal(list.length, 1)
  assert.equal(list[0].id, 't-gate')
  assert.equal(list[0].stopEnabled, true)
  assert.equal(list[0].manualEnabled, true)
})

test('gates/setDisabled mirrors both lists and answers the refreshed view through the gateway', async () => {
  const ctx = await wireHarness()
  const service = ctx.get('gates')
  service.register(gate())
  service.register(gate({ id: 't-other' }))

  const gateway = ctx.get('typertGateway')
  const after = await gateway.invoke({
    namespace: 'gates',
    method: 'setDisabled',
    args: { request: { stop: ['t-gate'], manual: ['t-other'], workspace: testRoot } },
  })
  assert.deepEqual(service.disabledTriggers(), { stop: ['t-gate'], manual: ['t-other'] })
  assert.equal(after.length, 2)
  assert.equal(after.find(view => view.id === 't-gate').stopEnabled, false)
  assert.equal(after.find(view => view.id === 't-gate').manualEnabled, true)
  assert.equal(after.find(view => view.id === 't-other').stopEnabled, true)
  assert.equal(after.find(view => view.id === 't-other').manualEnabled, false)
})

test('gates/setDisabled rejects a malformed payload as bad-request through the gateway', async () => {
  const ctx = await wireHarness()
  const gateway = ctx.get('typertGateway')
  await assert.rejects(
    () => gateway.invoke({ namespace: 'gates', method: 'setDisabled', args: { request: 'nope' } }),
    (error) => error.code === 'gateway/bad-request',
  )
  await assert.rejects(
    () => gateway.invoke({ namespace: 'gates', method: 'setDisabled', args: {} }),
    (error) => error.code === 'gateway/bad-request',
  )
  await assert.rejects(
    () => gateway.invoke({ namespace: 'gates', method: 'setDisabled', args: { request: { stop: ['x'], manual: 'nope' } } }),
    (error) => error.code === 'gateway/bad-request',
  )
})
