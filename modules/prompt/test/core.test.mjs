import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  PromptMiddlewareRunner,
  createPromptMiddlewareRegistry,
  renderRelates,
  validateProvider,
} from '../lib/core.js'

function provider(overrides = {}) {
  return {
    name: 'demo-provider',
    run: async () => [],
    ...overrides,
  }
}

test('registry registers, lists in order, and fails loud on duplicates', () => {
  const registry = createPromptMiddlewareRegistry()
  const a = provider({ name: 'a' })
  const b = provider({ name: 'b' })
  registry.register(a)
  registry.register(b)
  assert.deepEqual(registry.list().map(item => item.name), ['a', 'b'])
  assert.throws(() => registry.register(provider({ name: 'a' })), /already registered/)
})

test('validateProvider rejects malformed provider names', () => {
  validateProvider(provider({ name: 'ok-name' }))
  assert.throws(() => validateProvider(provider({ name: 'BadName' })), /must match/)
})

test('runner merges relates contributions by path and dedupes identical items', async () => {
  const runner = new PromptMiddlewareRunner()
  runner.register(provider({
    name: 'first',
    run: async () => [
      { path: 'docs/a.md', items: [{ kind: 'cognition-link', label: 'cognition', href: 'x.md' }] },
    ],
  }))
  runner.register(provider({
    name: 'second',
    run: async () => [
      { path: 'docs/a.md', items: [{ kind: 'cognition-link', label: 'cognition', href: 'x.md' }] },
      { path: 'docs/a.md', items: [{ kind: 'breadcrumb-description', label: 'breadcrumb', value: 'docs > a' }] },
    ],
  }))
  const result = await runner.run({
    prompt: 'docs/a.md',
    paths: [{ path: 'docs/a.md', kind: 'file', origin: 'prompt-parse' }],
    agent: {},
    cwd: '.',
    turnId: '1',
    signal: new AbortController().signal,
  })
  assert.deepEqual(result.relates, [{
    path: 'docs/a.md',
    items: [
      { kind: 'cognition-link', label: 'cognition', href: 'x.md' },
      { kind: 'breadcrumb-description', label: 'breadcrumb', value: 'docs > a' },
    ],
  }])
  assert.ok(result.text?.startsWith('relates:'))
  assert.ok(result.text?.includes('docs/a.md:'))
  assert.ok(result.text?.includes('- [cognition-link] x.md'))
  assert.ok(result.text?.includes('- [breadcrumb-description] docs > a'))
  assert.ok(!result.text?.includes('Prompt middleware context:'))
  assert.ok(!result.text?.includes('breadcrumb:'))
})

test('runner orders providers by priority before registration order', async () => {
  const runner = new PromptMiddlewareRunner()
  runner.register(provider({
    name: 'middle',
    run: async () => [{ path: 'a.md', items: [{ kind: 'k', label: 'middle', value: 'middle' }] }],
  }))
  runner.register(provider({
    name: 'early',
    priority: -1,
    run: async () => [{ path: 'a.md', items: [{ kind: 'k', label: 'early', value: 'early' }] }],
  }))
  runner.register(provider({
    name: 'late',
    priority: 1,
    run: async () => [{ path: 'a.md', items: [{ kind: 'k', label: 'late', value: 'late' }] }],
  }))
  const result = await runner.run({
    prompt: 'a.md',
    paths: [{ path: 'a.md', kind: 'file', origin: 'prompt-parse' }],
    agent: {},
    cwd: '.',
    turnId: '1',
  })
  assert.deepEqual(result.relates[0].items.map(item => item.label), ['early', 'middle', 'late'])
})

test('dedupe winner is registration order, not priority; display order stays priority', async () => {
  const runner = new PromptMiddlewareRunner()
  runner.register(provider({
    name: 'a',
    priority: 100,
    run: async () => [{ path: 'a.md', items: [{ kind: 'k', label: 'from-a', value: 'shared' }] }],
  }))
  runner.register(provider({
    name: 'b',
    priority: 0,
    run: async () => [{ path: 'a.md', items: [{ kind: 'k', label: 'from-b', value: 'shared' }] }],
  }))
  runner.register(provider({
    name: 'c',
    priority: 50,
    run: async () => [{ path: 'a.md', items: [{ kind: 'other', label: 'from-c', value: 'c-value' }] }],
  }))
  const result = await runner.run({
    prompt: 'a.md',
    paths: [{ path: 'a.md', kind: 'file', origin: 'prompt-parse' }],
    agent: {},
    cwd: '.',
    turnId: '1',
  })
  // `a` (registered first) beats `b` (higher priority) for the same key;
  // `c` (different kind, priority 50) sorts before `a` (priority 100).
  assert.deepEqual(result.relates[0].items, [
    { kind: 'other', label: 'from-c', value: 'c-value' },
    { kind: 'k', label: 'from-a', value: 'shared' },
  ])
})

test('runner discards unknown provider paths and traces the drop', async () => {
  const runner = new PromptMiddlewareRunner()
  runner.register(provider({
    name: 'unknown',
    run: async () => [{ path: 'missing.md', items: [{ kind: 'x', label: 'x' }] }],
  }))
  const result = await runner.run({
    prompt: 'missing.md',
    paths: [{ path: 'known.md', kind: 'file', origin: 'prompt-parse' }],
    agent: {},
    cwd: '.',
    turnId: '1',
    signal: new AbortController().signal,
  })
  assert.deepEqual(result.relates, [])
  assert.equal(result.text, undefined)
  assert.ok(result.trace.some(event => event.provider === 'unknown' && event.status === 'skipped' && event.reason.includes('unknown path')))
})

test('runner skips empty path list without running providers', async () => {
  let ran = false
  const runner = new PromptMiddlewareRunner()
  runner.register(provider({
    name: 'not-run',
    run: async () => {
      ran = true
      return []
    },
  }))
  const result = await runner.run({
    prompt: 'missing.md',
    paths: [],
    agent: {},
    cwd: '.',
    turnId: '1',
  })
  assert.equal(ran, false)
  assert.deepEqual(result.relates, [])
  assert.equal(result.text, undefined)
})

test('runner contains provider failures and keeps later providers running', async () => {
  const runner = new PromptMiddlewareRunner()
  runner.register(provider({
    name: 'boom',
    run: async () => { throw new Error('exploded') },
  }))
  runner.register(provider({
    name: 'after',
    run: async () => [{ path: 'a.md', items: [{ kind: 'k', label: 'after', value: 'ok' }] }],
  }))
  const result = await runner.run({
    prompt: 'a.md',
    paths: [{ path: 'a.md', kind: 'file', origin: 'prompt-parse' }],
    agent: {},
    cwd: '.',
    turnId: '1',
  })
  assert.deepEqual(result.relates[0].items, [{ kind: 'k', label: 'after', value: 'ok' }])
  assert.ok(result.trace.some(event => event.provider === 'boom' && event.status === 'failed' && event.reason === 'exploded'))
})

test('runner reports provider timeout without blocking later providers', async () => {
  const runner = new PromptMiddlewareRunner({ providerTimeoutMs: 10, totalTimeoutMs: 100 })
  runner.register(provider({
    name: 'slow',
    run: () => new Promise(() => {}),
  }))
  runner.register(provider({
    name: 'after',
    run: async () => [{ path: 'a.md', items: [{ kind: 'k', label: 'after', value: 'ok' }] }],
  }))
  const result = await runner.run({
    prompt: 'a.md',
    paths: [{ path: 'a.md', kind: 'file', origin: 'prompt-parse' }],
    agent: {},
    cwd: '.',
    turnId: '1',
  })
  assert.deepEqual(result.relates[0].items, [{ kind: 'k', label: 'after', value: 'ok' }])
  assert.ok(result.trace.some(event => event.provider === 'slow' && event.status === 'timed-out'))
})

test('renderRelates truncates when it exceeds the budget', () => {
  const rendered = renderRelates([
    { path: 'a.md', items: [{ kind: 'k', label: 'label', value: 'value' }] },
  ], 10)
  assert.equal(rendered.text, undefined)
  assert.equal(rendered.truncated, true)
})

test('validateProvider rejects an unknown mode', () => {
  assert.throws(() => validateProvider(provider({ name: 'ok-name', mode: 'sometimes' })), /mode must be 'always' or 'once'/)
})

test('once-mode provider injects each path once per session, then clearSession re-arms', async () => {
  const runner = new PromptMiddlewareRunner()
  runner.register(provider({
    name: 'once-provider',
    mode: 'once',
    run: async ({ paths }) => paths.map((p) => ({
      path: p.path,
      items: [{ kind: 'k', label: p.path, value: p.path }],
    })),
  }))
  const run = (path, sessionId) => runner.run({
    prompt: path,
    paths: [{ path, kind: 'file', origin: 'prompt-parse' }],
    agent: {},
    cwd: '.',
    turnId: '1',
    sessionId,
  })

  assert.equal((await run('a.md', 's1')).relates[0].items.length, 1)

  const repeat = await run('a.md', 's1')
  assert.deepEqual(repeat.relates, [])
  assert.ok(repeat.trace.some((event) => event.provider === 'once-provider' && event.status === 'skipped' && event.reason.includes('already injected this session')))

  // A different path in the same session still injects.
  assert.equal((await run('b.md', 's1')).relates[0].items.length, 1)
  // Another session is independent.
  assert.equal((await run('a.md', 's2')).relates[0].items.length, 1)

  runner.clearSession('s1')
  assert.equal((await run('a.md', 's1')).relates[0].items.length, 1)
})

test('once-mode provider is not re-invoked when every path is already injected', async () => {
  let runs = 0
  const runner = new PromptMiddlewareRunner()
  runner.register(provider({
    name: 'once-counter',
    mode: 'once',
    run: async ({ paths }) => {
      runs += 1
      return paths.map((p) => ({
        path: p.path,
        items: [{ kind: 'k', label: p.path, value: p.path }],
      }))
    },
  }))
  const run = (path, sessionId) => runner.run({
    prompt: path,
    paths: [{ path, kind: 'file', origin: 'prompt-parse' }],
    agent: {},
    cwd: '.',
    turnId: '1',
    sessionId,
  })

  assert.equal((await run('a.md', 's1')).relates[0].items.length, 1)
  assert.equal(runs, 1)

  const repeat = await run('a.md', 's1')
  assert.deepEqual(repeat.relates, [])
  assert.ok(repeat.trace.some((event) => event.provider === 'once-counter' && event.status === 'skipped' && event.reason.includes('already injected this session')))
  assert.equal(runs, 1)

  // A different path in the same session still invokes and injects.
  assert.equal((await run('b.md', 's1')).relates[0].items.length, 1)
  assert.equal(runs, 2)

  // clearSession re-arms, so the provider runs again for the same path.
  runner.clearSession('s1')
  assert.equal((await run('a.md', 's1')).relates[0].items.length, 1)
  assert.equal(runs, 3)
})

test('once-mode provider without a sessionId contributes on every run', async () => {
  const runner = new PromptMiddlewareRunner()
  runner.register(provider({
    name: 'scopeless',
    mode: 'once',
    run: async ({ paths }) => paths.map((p) => ({
      path: p.path,
      items: [{ kind: 'k', label: 'x', value: p.path }],
    })),
  }))
  const run = () => runner.run({
    prompt: 'a.md',
    paths: [{ path: 'a.md', kind: 'file', origin: 'prompt-parse' }],
    agent: {},
    cwd: '.',
    turnId: '1',
  })
  assert.equal((await run()).relates[0].items.length, 1)
  assert.equal((await run()).relates[0].items.length, 1)
})

test('once-mode item truncated by the render budget is not marked injected and is re-offered next turn', async () => {
  let runs = 0
  const runner = new PromptMiddlewareRunner({ renderBudgetChars: 10 })
  runner.register(provider({
    name: 'truncated-once',
    mode: 'once',
    run: async ({ paths }) => {
      runs += 1
      return paths.map((p) => ({
        path: p.path,
        items: [{ kind: 'k', label: p.path, value: `${p.path}-` + 'x'.repeat(500) }],
      }))
    },
  }))
  const run = (path, sessionId) => runner.run({
    prompt: path,
    paths: [{ path, kind: 'file', origin: 'prompt-parse' }],
    agent: {},
    cwd: '.',
    turnId: '1',
    sessionId,
  })

  // Turn 1: the tiny budget truncates the only item, so nothing renders.
  const first = await run('a.md', 's1')
  assert.equal(first.text, undefined)
  assert.ok(first.trace.some((event) => event.status === 'truncated'))
  assert.equal(runs, 1)

  // The truncated item was NOT marked injected: the same session re-offers the
  // path and the provider is invoked again instead of skipping with
  // 'already injected this session'.
  const second = await run('a.md', 's1')
  assert.equal(runs, 2)
  assert.equal(second.text, undefined)
  assert.ok(second.trace.some((event) => event.status === 'truncated'))
  assert.ok(!second.trace.some((event) => event.reason?.includes('already injected this session')))
})

test('once-mode item truncated by the render budget re-injects in the same session once the budget allows', async () => {
  let runs = 0
  const runner = new PromptMiddlewareRunner({ renderBudgetChars: 60 })
  runner.register(provider({
    name: 'fits-one-once',
    mode: 'once',
    run: async ({ paths }) => {
      runs += 1
      return paths.map((p) => ({
        path: p.path,
        items: [{ kind: 'k', label: p.path, value: p.path[0].repeat(20) }],
      }))
    },
  }))
  const run = (paths, sessionId) => runner.run({
    prompt: paths.map((path) => path.path).join(' '),
    paths,
    agent: {},
    cwd: '.',
    turnId: '1',
    sessionId,
  })
  const a = { path: 'a.md', kind: 'file', origin: 'prompt-parse' }
  const b = { path: 'b.md', kind: 'file', origin: 'prompt-parse' }

  // Turn 1: the budget fits exactly one item, so a.md renders (and is marked)
  // while b.md is truncated (and is NOT marked).
  const first = await run([a, b], 's1')
  assert.equal(runs, 1)
  assert.ok(first.text?.includes('a.md:'))
  assert.ok(!first.text?.includes('b.md:'))
  assert.ok(first.trace.some((event) => event.status === 'truncated'))

  // Turn 2: b.md alone fits the budget, and because it was never marked
  // injected it is re-offered and injected in the same session.
  const second = await run([b], 's1')
  assert.equal(runs, 2)
  assert.deepEqual(second.relates, [{ path: 'b.md', items: [{ kind: 'k', label: 'b.md', value: 'b'.repeat(20) }] }])
  assert.ok(second.text?.includes('b.md:'))
  assert.ok(!second.trace.some((event) => event.reason?.includes('already injected this session')))
  assert.ok(!second.trace.some((event) => event.status === 'truncated'))
})
