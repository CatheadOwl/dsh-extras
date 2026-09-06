// Introspection tests: the read-only self-description snapshot
// (`service.introspect()`) — descriptor projection, signal-source
// materialization, and the provenance split across the two disable entries
// (browser mirror + config). The snapshot is the single query surface the
// settings tab and headless consumers project from; it never writes.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Context } from '@deepseek-ai/cordis'

import { PromptMiddlewareService } from '../lib/service.js'

function provider(overrides = {}) {
  return { name: 'demo-provider', run: async () => [], ...overrides }
}

function relatesProvider(overrides = {}) {
  return { name: 'demo-relates', kind: 'demo', resolve: async () => undefined, ...overrides }
}

async function serviceHarness(config = {}) {
  const ctx = new Context()
  await ctx.plugin(PromptMiddlewareService, config)
  return ctx.get('promptMiddleware')
}

test('introspect projects descriptors with sources defaulting to prompt-only', async () => {
  const service = await serviceHarness()
  service.register(provider({ name: 'imp', mode: 'always', priority: 2, description: 'imperative one-liner' }))
  service.registerRelates(relatesProvider({ name: 'dec', kind: 'cognition-link', priority: 1 }))
  service.registerRelates(relatesProvider({
    name: 'touchy',
    kind: 'touch-kind',
    sources: ['prompt', 'touch'],
    touchSubjects: () => [],
  }))

  const rows = service.introspect()
  const by = Object.fromEntries(rows.map(row => [row.name, row]))
  assert.deepEqual(rows.map(row => row.name), ['touchy', 'dec', 'imp'])
  assert.deepEqual(by.dec, {
    name: 'dec',
    kind: 'cognition-link',
    priority: 1,
    mode: 'once',
    sources: ['prompt'],
    effectiveEnabled: true,
    disabledBy: null,
  })
  assert.deepEqual(by.imp, {
    name: 'imp',
    description: 'imperative one-liner',
    priority: 2,
    mode: 'always',
    sources: ['prompt'],
    effectiveEnabled: true,
    disabledBy: null,
  })
  assert.deepEqual(by.touchy.sources, ['prompt', 'touch'])
  assert.equal('kind' in by.imp, false)
})

test('introspect attributes provenance across both disable entries', async () => {
  const service = await serviceHarness({ disabledProviders: ['cfg-off', 'both-off'] })
  service.register(provider({ name: 'user-off' }))
  service.register(provider({ name: 'cfg-off' }))
  service.register(provider({ name: 'both-off' }))
  service.register(provider({ name: 'on' }))
  service.setDisabled(['user-off', 'both-off'])

  const rows = service.introspect()
  const by = Object.fromEntries(rows.map(row => [row.name, row]))
  assert.deepEqual(by['user-off'].disabledBy, 'user')
  assert.deepEqual(by['cfg-off'].disabledBy, 'config')
  assert.deepEqual(by['both-off'].disabledBy, 'both')
  assert.deepEqual(by.on.disabledBy, null)
  assert.equal(by['user-off'].effectiveEnabled, false)
  assert.equal(by['cfg-off'].effectiveEnabled, false)
  assert.equal(by['both-off'].effectiveEnabled, false)
  assert.equal(by.on.effectiveEnabled, true)
})

test('introspect provenance matches what the runner actually enforces', async () => {
  // The snapshot's effectiveEnabled must agree with run()'s union filter:
  // same two sets, same semantics — otherwise the UI would lie about behavior.
  const service = await serviceHarness({ disabledProviders: ['cfg-off'] })
  const ran = { 'user-off': false, 'cfg-off': false, on: false }
  service.register(provider({ name: 'user-off', run: async () => { ran['user-off'] = true; return [] } }))
  service.register(provider({ name: 'cfg-off', run: async () => { ran['cfg-off'] = true; return [] } }))
  service.register(provider({ name: 'on', run: async () => { ran.on = true; return [] } }))
  service.setDisabled(['user-off'])

  await service.run({
    prompt: 'a.md',
    paths: [{ path: 'a.md', kind: 'file', origin: 'prompt-parse' }],
    agent: {},
    cwd: '.',
    turnId: '1',
  })
  const rows = service.introspect()
  for (const row of rows) {
    assert.equal(row.effectiveEnabled, ran[row.name])
  }
})

test('a provider without optional fields yields a row without the keys', async () => {
  const service = await serviceHarness()
  service.register(provider({ name: 'bare' }))
  const [row] = service.introspect()
  assert.deepEqual(row, { name: 'bare', mode: 'always', sources: ['prompt'], effectiveEnabled: true, disabledBy: null })
  assert.equal('description' in row, false)
  assert.equal('kind' in row, false)
  assert.equal('priority' in row, false)
  assert.equal('timeoutMs' in row, false)
})
