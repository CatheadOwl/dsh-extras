// Toggle tests: the Settings → Plugins → Prompt Middleware surface — the
// browser-owned disabled-name list mirrored into host memory, the runner's
// per-provider filtering (before `once` dedupe), and the service's mirror +
// listViews. These tests stay on the pure runner/service boundary: no driver,
// no agent loop.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Context } from '@deepseek-ai/cordis'

import { PromptMiddlewareRunner } from '../lib/core.js'
import { PromptMiddlewareService } from '../lib/service.js'

function provider(overrides = {}) {
  return { name: 'demo-provider', run: async () => [], ...overrides }
}

function relatesProvider(overrides = {}) {
  return { name: 'demo-relates', kind: 'demo', resolve: async () => undefined, ...overrides }
}

async function serviceHarness() {
  const ctx = new Context()
  await ctx.plugin(PromptMiddlewareService, {})
  return ctx.get('promptMiddleware')
}

function run(runner, { path = 'a.md', sessionId, disabled, turnId = '1' } = {}) {
  return runner.run({
    prompt: path,
    paths: [{ path, kind: 'file', origin: 'prompt-parse' }],
    agent: {},
    cwd: '.',
    turnId,
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(disabled !== undefined ? { disabled } : {}),
    signal: new AbortController().signal,
  })
}

test('a disabled always provider does not run and traces skipped', async () => {
  let ran = false
  const runner = new PromptMiddlewareRunner()
  runner.register(provider({
    name: 'always-on',
    mode: 'always',
    run: async () => {
      ran = true
      return [{ path: 'a.md', items: [{ kind: 'k', label: 'x', value: 'x' }] }]
    },
  }))
  const result = await run(runner, { disabled: new Set(['always-on']) })
  assert.equal(ran, false)
  assert.deepEqual(result.relates, [])
  assert.ok(result.trace.some(e => e.provider === 'always-on' && e.status === 'skipped' && e.reason === 'disabled by user'))
})

test('a disabled once provider does not run and never touches the ledger', async () => {
  let ran = false
  const runner = new PromptMiddlewareRunner()
  runner.register(provider({
    name: 'once-on',
    mode: 'once',
    run: async () => {
      ran = true
      return [{ path: 'a.md', items: [{ kind: 'k', label: 'x', value: 'x' }] }]
    },
  }))
  const first = await run(runner, { sessionId: 's1', disabled: new Set(['once-on']) })
  assert.equal(ran, false)
  assert.deepEqual(first.relates, [])
  assert.ok(first.trace.some(e => e.provider === 'once-on' && e.status === 'skipped' && e.reason === 'disabled by user'))

  // Filter-only: the disabled run wrote nothing to the ledger, so re-enabling
  // injects the path now (it was never marked injected).
  const second = await run(runner, { sessionId: 's1', disabled: new Set() })
  assert.equal(ran, true)
  assert.equal(second.relates.length, 1)
})

test('re-enabling a once provider keeps injected paths suppressed but injects new paths', async () => {
  const runner = new PromptMiddlewareRunner()
  runner.register(provider({
    name: 'once-on',
    mode: 'once',
    run: async ({ paths }) => paths.map(p => ({
      path: p.path,
      items: [{ kind: 'k', label: p.path, value: p.path }],
    })),
  }))

  // Inject a.md once.
  assert.equal((await run(runner, { path: 'a.md', sessionId: 's1' })).relates.length, 1)

  // Disable, then re-enable: a.md was already injected → still suppressed.
  await run(runner, { path: 'a.md', sessionId: 's1', disabled: new Set(['once-on']) })
  const reenabled = await run(runner, { path: 'a.md', sessionId: 's1', disabled: new Set() })
  assert.deepEqual(reenabled.relates, [])
  assert.ok(reenabled.trace.some(e => e.status === 'skipped' && e.reason?.includes('already injected this session')))

  // A new path injects immediately.
  assert.equal((await run(runner, { path: 'b.md', sessionId: 's1' })).relates.length, 1)

  // clearSession (surface replace) restores a.md.
  runner.clearSession('s1')
  assert.equal((await run(runner, { path: 'a.md', sessionId: 's1' })).relates.length, 1)
})

test('disabling one provider leaves others running; an empty disabled set matches baseline', async () => {
  const runner = new PromptMiddlewareRunner()
  runner.register(provider({ name: 'off', run: async () => [{ path: 'a.md', items: [{ kind: 'k', label: 'off', value: 'off' }] }] }))
  runner.register(provider({ name: 'on', run: async () => [{ path: 'a.md', items: [{ kind: 'k', label: 'on', value: 'on' }] }] }))

  const disabled = await run(runner, { disabled: new Set(['off']) })
  assert.deepEqual(disabled.relates[0].items.map(item => item.label), ['on'])
  assert.ok(disabled.trace.some(e => e.provider === 'off' && e.status === 'skipped' && e.reason === 'disabled by user'))

  // Regression anchor: an empty disabled set behaves exactly like none at all.
  // `durationMs` is wall-clock and non-deterministic, so compare it separately
  // from the stable trace fields.
  const stable = (trace) => trace.map(({ durationMs, ...rest }) => rest)
  const empty = await run(runner, { disabled: new Set() })
  const none = await run(runner)
  assert.deepEqual(empty.relates, none.relates)
  assert.deepEqual(stable(empty.trace), stable(none.trace))
})

test('the service mirror starts empty, replaces entirely, and is idempotent', async () => {
  const service = await serviceHarness()
  assert.deepEqual(service.disabledIds(), [])
  service.setDisabled(['a', 'b'])
  assert.deepEqual(service.disabledIds(), ['a', 'b'])
  service.setDisabled(['a', 'b'])
  assert.deepEqual(service.disabledIds(), ['a', 'b'])
  service.setDisabled(['b'])
  assert.deepEqual(service.disabledIds(), ['b'])
  service.setDisabled([])
  assert.deepEqual(service.disabledIds(), [])
})

test('listViews reports every provider enabled until setDisabled, with kind/source split', async () => {
  const service = await serviceHarness()
  service.register(provider({ name: 'imp', mode: 'always', priority: 2, timeoutMs: 500 }))
  service.registerRelates(relatesProvider({ name: 'dec', kind: 'cognition-link', priority: 1 }))

  const views = service.listViews()
  assert.deepEqual(views.map(view => view.name), ['dec', 'imp'])
  assert.deepEqual(views[0], { name: 'dec', kind: 'cognition-link', priority: 1, mode: 'once', source: 'declarative', enabled: true })
  assert.deepEqual(views[1], { name: 'imp', priority: 2, timeoutMs: 500, mode: 'always', source: 'imperative', enabled: true })

  service.setDisabled(['dec'])
  const disabled = service.listViews()
  assert.equal(disabled.find(view => view.name === 'dec').enabled, false)
  assert.equal(disabled.find(view => view.name === 'imp').enabled, true)
})

test('run() enforces the service mirror without a caller disabled set', async () => {
  const service = await serviceHarness()
  let ran = false
  service.register(provider({ name: 'off', run: async () => { ran = true; return [] } }))
  service.setDisabled(['off'])

  const result = await service.run({
    prompt: 'a.md',
    paths: [{ path: 'a.md', kind: 'file', origin: 'prompt-parse' }],
    agent: {},
    cwd: '.',
    turnId: '1',
  })
  assert.equal(ran, false)
  assert.ok(result.trace.some(e => e.provider === 'off' && e.status === 'skipped' && e.reason === 'disabled by user'))
})

test('run() unions a caller disabled set with the service mirror', async () => {
  const service = await serviceHarness()
  const ran = { a: false, b: false }
  service.register(provider({ name: 'a', run: async () => { ran.a = true; return [] } }))
  service.register(provider({ name: 'b', run: async () => { ran.b = true; return [] } }))
  service.setDisabled(['a'])

  const result = await service.run({
    prompt: 'a.md',
    paths: [{ path: 'a.md', kind: 'file', origin: 'prompt-parse' }],
    agent: {},
    cwd: '.',
    turnId: '1',
    disabled: new Set(['b']),
  })
  assert.equal(ran.a, false)
  assert.equal(ran.b, false)
  assert.equal(result.trace.filter(e => e.status === 'skipped' && e.reason === 'disabled by user').length, 2)
})
