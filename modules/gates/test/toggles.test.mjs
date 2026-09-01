// Toggle tests: the Settings → Plugins → Gates surface — the browser-owned
// per-trigger disabled lists mirrored into host memory via the `gates` remote,
// the service's per-dimension filtering (turn-stop / manual run-all / explicit
// single-gate runs), and the Typert controller's list/setDisabled.
//
// These tests DO import the dsh host's `@deepseek-ai/*` packages (through the
// plugin's local junctions) because the controller and service need a Cordis
// context. The LLM/agent stack stays out — only the tools service (the
// plugin's declared inject) is mounted.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

import { excludeDisabledGates } from '../lib/core.js'
import * as gates from '../lib/index.js'

const testRoot = mkdtempSync(join(tmpdir(), 'gates-toggle-tests-'))
test.after(() => rmSync(testRoot, { recursive: true, force: true }))

function gate(overrides) {
  return {
    id: 't-gate',
    description: 'toggle test gate',
    rationale: 'test rationale',
    on: ['stop', 'manual'],
    level: 'blocking',
    check: async () => [],
    ...overrides,
  }
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(gates, {})
  return ctx
}

test('excludeDisabledGates keeps order and drops disabled ids', () => {
  const definitions = [gate({ id: 'a' }), gate({ id: 'b' }), gate({ id: 'c' })]
  assert.deepEqual(excludeDisabledGates(definitions, ['b']).map(d => d.id), ['a', 'c'])
  assert.deepEqual(excludeDisabledGates(definitions, ['unknown']).map(d => d.id), ['a', 'b', 'c'])
  assert.deepEqual(excludeDisabledGates(definitions, []).map(d => d.id), ['a', 'b', 'c'])
})

test('the controller lists every gate with its per-trigger enabled state', async () => {
  const ctx = await harness()
  const service = ctx.get('gates')
  service.register(gate())
  const controller = ctx.get('gatesController')
  const view = controller.list({ workspace: testRoot })
  assert.equal(view.length, 1)
  assert.equal(view[0].id, 't-gate')
  assert.equal(view[0].stopEnabled, true)
  assert.equal(view[0].manualEnabled, true)
  assert.equal(view[0].source, 'plugin')
})

test('disabling only the stop trigger removes a gate from turn-stop but keeps it runnable manually', async () => {
  const ctx = await harness()
  const service = ctx.get('gates')
  const controller = ctx.get('gatesController')
  service.register(gate())
  service.register(gate({ id: 't-other' }))

  await controller.setDisabled({ stop: ['t-gate'], manual: [], workspace: testRoot })

  assert.deepEqual(service.disabledTriggers(), { stop: ['t-gate'], manual: [] })
  // Turn-stop selection drops it; the manual run-all path keeps it.
  assert.deepEqual(
    service.runnableDefinitions(testRoot, 'stop').map(definition => definition.id),
    ['t-other'],
  )
  assert.deepEqual(
    service.runnableDefinitions(testRoot, 'manual').map(definition => definition.id),
    ['t-gate', 't-other'],
  )
  const results = await service.run(testRoot)
  assert.deepEqual(results.map(result => result.gateId), ['t-gate', 't-other'])
  // An explicit single run still works (the manual dimension is on).
  const single = await service.run(testRoot, { gate: 't-gate' })
  assert.deepEqual(single.map(result => result.gateId), ['t-gate'])
})

test('disabling only the manual trigger removes a gate from run-all and explicit single runs fail loud', async () => {
  const ctx = await harness()
  const service = ctx.get('gates')
  const controller = ctx.get('gatesController')
  service.register(gate())

  await controller.setDisabled({ stop: [], manual: ['t-gate'], workspace: testRoot })

  assert.deepEqual(service.disabledTriggers(), { stop: [], manual: ['t-gate'] })
  // Turn-stop selection keeps it; the manual run-all path drops it.
  assert.deepEqual(
    service.runnableDefinitions(testRoot, 'stop').map(definition => definition.id),
    ['t-gate'],
  )
  assert.deepEqual(
    service.runnableDefinitions(testRoot, 'manual').map(definition => definition.id),
    [],
  )
  assert.equal((await service.run(testRoot)).length, 0)
  await assert.rejects(() => service.run(testRoot, { gate: 't-gate' }), /disabled for manual runs/)
})

test('disabling both triggers removes a gate from every path', async () => {
  const ctx = await harness()
  const service = ctx.get('gates')
  const controller = ctx.get('gatesController')
  service.register(gate())
  service.register(gate({ id: 't-other' }))

  await controller.setDisabled({ stop: ['t-gate'], manual: ['t-gate'], workspace: testRoot })

  assert.deepEqual(
    service.runnableDefinitions(testRoot, 'stop').map(definition => definition.id),
    ['t-other'],
  )
  assert.deepEqual(
    service.runnableDefinitions(testRoot, 'manual').map(definition => definition.id),
    ['t-other'],
  )
  assert.deepEqual((await service.run(testRoot)).map(result => result.gateId), ['t-other'])
})

test('a gate not opting into a trigger never runs on that trigger, regardless of switches', async () => {
  const ctx = await harness()
  const service = ctx.get('gates')
  const controller = ctx.get('gatesController')
  service.register(gate({ id: 'stop-only', on: ['stop'] }))

  // User tries to enable it manually too — the declaration is the upper bound.
  await controller.setDisabled({ stop: [], manual: [], workspace: testRoot })
  assert.deepEqual(
    service.runnableDefinitions(testRoot, 'stop').map(definition => definition.id),
    ['stop-only'],
  )
  assert.deepEqual(
    service.runnableDefinitions(testRoot, 'manual').map(definition => definition.id),
    [],
  )
})

test('re-enabling restores the gate everywhere', async () => {
  const ctx = await harness()
  const service = ctx.get('gates')
  const controller = ctx.get('gatesController')
  service.register(gate())

  await controller.setDisabled({ stop: ['t-gate'], manual: ['t-gate'], workspace: testRoot })
  assert.equal((await service.run(testRoot)).length, 0)

  const view = await controller.setDisabled({ stop: [], manual: [], workspace: testRoot })
  assert.equal(view[0].stopEnabled, true)
  assert.equal(view[0].manualEnabled, true)
  const results = await service.run(testRoot)
  assert.deepEqual(results.map(result => result.gateId), ['t-gate'])
})

test('setDisabled replaces both lists entirely (stale ids do not linger)', async () => {
  const ctx = await harness()
  const service = ctx.get('gates')
  const controller = ctx.get('gatesController')
  service.register(gate())
  service.register(gate({ id: 't-other' }))

  await controller.setDisabled({ stop: ['t-gate', 't-other'], manual: ['t-gate'], workspace: testRoot })
  await controller.setDisabled({ stop: ['t-gate'], manual: ['t-other'], workspace: testRoot })
  assert.deepEqual(service.disabledTriggers(), { stop: ['t-gate'], manual: ['t-other'] })
  assert.deepEqual(
    service.runnableDefinitions(testRoot, 'manual').map(definition => definition.id),
    ['t-gate'],
  )
})

test('setDisabled rejects a malformed payload', async () => {
  const ctx = await harness()
  const controller = ctx.get('gatesController')
  assert.throws(() => controller.setDisabled({ stop: 'not-an-array', manual: [] }), /stop and manual gate id string lists/)
  assert.throws(() => controller.setDisabled({ stop: [], manual: 'not-an-array' }), /stop and manual gate id string lists/)
  assert.throws(() => controller.setDisabled({ stop: [42], manual: [] }), /stop and manual gate id string lists/)
  assert.throws(() => controller.setDisabled({ manual: [] }), /stop and manual gate id string lists/)
})

test('unknown ids in the disabled lists are harmless (they match nothing)', async () => {
  const ctx = await harness()
  const service = ctx.get('gates')
  const controller = ctx.get('gatesController')
  service.register(gate())

  const view = await controller.setDisabled({ stop: ['no-such-gate'], manual: [], workspace: testRoot })
  assert.equal(view[0].stopEnabled, true)
  assert.equal(view[0].manualEnabled, true)
  assert.deepEqual(service.disabledTriggers(), { stop: ['no-such-gate'], manual: [] })
  assert.equal((await service.run(testRoot)).length, 1)
})

test('run() honors an explicit trigger at the service boundary', async () => {
  const ctx = await harness()
  const service = ctx.get('gates')
  const controller = ctx.get('gatesController')
  service.register(gate({ id: 't-stop', on: ['stop'] }))
  service.register(gate({ id: 't-both', on: ['stop', 'manual'] }))

  // Default run is the manual dimension: only t-both.
  assert.deepEqual((await service.run(testRoot)).map(result => result.gateId), ['t-both'])
  // Explicit stop trigger: both gates (each opts into stop).
  assert.deepEqual(
    (await service.run(testRoot, { trigger: 'stop' })).map(result => result.gateId),
    ['t-stop', 't-both'],
  )
  // Disabling the stop dimension removes t-both from the stop run but not manual.
  await controller.setDisabled({ stop: ['t-both'], manual: [], workspace: testRoot })
  assert.deepEqual(
    (await service.run(testRoot, { trigger: 'stop' })).map(result => result.gateId),
    ['t-stop'],
  )
  assert.deepEqual((await service.run(testRoot)).map(result => result.gateId), ['t-both'])
})

test('unknown ids in both lists simultaneously are harmless', async () => {
  const ctx = await harness()
  const service = ctx.get('gates')
  const controller = ctx.get('gatesController')
  service.register(gate())

  const view = await controller.setDisabled({
    stop: ['no-such-a'],
    manual: ['no-such-b'],
    workspace: testRoot,
  })
  assert.equal(view[0].stopEnabled, true)
  assert.equal(view[0].manualEnabled, true)
  assert.deepEqual(service.disabledTriggers(), { stop: ['no-such-a'], manual: ['no-such-b'] })
  assert.equal((await service.run(testRoot)).length, 1)
})
