import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createGateRegistry } from '../lib/core.js'
import { registerGate } from '../lib/register.js'

function gate(overrides) {
  return {
    id: 'consumer-gate',
    description: 'consumer gate',
    rationale: 'consumer rationale',
    on: ['manual'],
    level: 'advisory',
    check: async () => [],
    ...overrides,
  }
}

// Drive registerGate's inject seam with the REAL registry wired into the
// callback. The fake only replaces the soft-dependency boundary (ctx.inject),
// exactly like skills.test.mjs; validation and duplicate-id logic stay real.
function captureRegistration() {
  const registry = createGateRegistry()
  const deps = []
  const ctx = {
    inject(injectDeps, callback) {
      deps.push(injectDeps)
      return callback({ gates: { register: definition => registry.register(definition) } })
    },
  }
  return { ctx, registry, deps }
}

test('registerGate declares gates as a soft dependency via ctx.inject', () => {
  const { ctx, deps } = captureRegistration()
  registerGate(ctx, gate())
  assert.deepEqual(deps, [['gates']])
})

test('registerGate routes the definition into the ctx.gates registry', () => {
  const { ctx, registry } = captureRegistration()
  const definition = gate({ id: 'consumer-gate' })
  registerGate(ctx, definition)
  assert.equal(registry.list().length, 1)
  assert.equal(registry.get('consumer-gate'), definition)
})

test('registerGate surfaces duplicate-id registration failures from the registry', () => {
  const { ctx } = captureRegistration()
  registerGate(ctx, gate({ id: 'consumer-gate' }))
  assert.throws(() => registerGate(ctx, gate({ id: 'consumer-gate' })), /already registered/)
})

test('registerGate surfaces invalid definition vocabulary from the registry', () => {
  const { ctx } = captureRegistration()
  assert.throws(() => registerGate(ctx, gate({ id: 'BadId' })), /must match/)
})
