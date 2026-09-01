import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PromptMiddlewareRunner } from '../lib/core.js'

function relatesProvider(overrides = {}) {
  return {
    name: 'demo-relates',
    kind: 'demo',
    resolve: async () => undefined,
    ...overrides,
  }
}

function runPaths(runner, paths, { sessionId, turnId = '1' } = {}) {
  return runner.run({
    prompt: paths.map((path) => path.path).join(' '),
    paths,
    agent: {},
    cwd: '.',
    turnId,
    ...(sessionId !== undefined ? { sessionId } : {}),
    signal: new AbortController().signal,
  })
}

function runOne(runner, { path = 'a.md', sessionId, turnId = '1' } = {}) {
  return runPaths(runner, [{ path, kind: 'file', origin: 'prompt-parse' }], { sessionId, turnId })
}

test('declarative provider emits one item per path with label === kind', async () => {
  const runner = new PromptMiddlewareRunner()
  runner.registerRelates(relatesProvider({
    name: 'links',
    kind: 'cognition-link',
    resolve: async ({ path }) => ({ href: `cog/${path.path}` }),
  }))
  const result = await runPaths(runner, [
    { path: 'a.md', kind: 'file', origin: 'prompt-parse' },
    { path: 'b.md', kind: 'file', origin: 'prompt-parse' },
  ])
  assert.deepEqual(result.relates, [
    { path: 'a.md', items: [{ kind: 'cognition-link', label: 'cognition-link', href: 'cog/a.md' }] },
    { path: 'b.md', items: [{ kind: 'cognition-link', label: 'cognition-link', href: 'cog/b.md' }] },
  ])
})

test('declarative provider defaults to once and clearSession re-arms', async () => {
  const runner = new PromptMiddlewareRunner()
  runner.registerRelates(relatesProvider({
    name: 'links',
    kind: 'cognition-link',
    resolve: async ({ path }) => ({ href: `cog/${path.path}` }),
  }))
  const first = await runOne(runner, { path: 'a.md', sessionId: 's1' })
  assert.equal(first.relates[0].items.length, 1)

  const second = await runOne(runner, { path: 'a.md', sessionId: 's1' })
  assert.deepEqual(second.relates, [])
  assert.ok(second.trace.some((event) => event.provider === 'links' && event.status === 'skipped' && event.reason.includes('already injected this session')))

  runner.clearSession('s1')
  const third = await runOne(runner, { path: 'a.md', sessionId: 's1' })
  assert.equal(third.relates[0].items.length, 1)
})

test('subjectOf re-keys the group and the once ledger onto the declared subject', async () => {
  const runner = new PromptMiddlewareRunner()
  runner.registerRelates(relatesProvider({
    name: 'crumbs',
    kind: 'breadcrumb-description',
    // backslashes on purpose: the framework canonicalizes the projection
    subjectOf: (p) => (p.kind === 'file' ? p.path.split('/').slice(0, -1).join('\\') : p.path),
    resolve: async () => ({ value: 'ancestor chain' }),
  }))
  const first = await runPaths(runner, [
    { path: 'A/B/C/1.md', kind: 'file', origin: 'prompt-parse' },
    { path: 'A/B/C/2.md', kind: 'file', origin: 'prompt-parse' },
  ], { sessionId: 's1' })
  // Sibling files collapse into ONE group keyed by the shared directory.
  assert.deepEqual(first.relates, [
    { path: 'A/B/C', items: [{ kind: 'breadcrumb-description', label: 'breadcrumb-description', value: 'ancestor chain' }] },
  ])
  assert.ok(first.text?.includes('A/B/C:'))

  // The once ledger keys the subject: another sibling is suppressed next turn.
  const second = await runOne(runner, { path: 'A/B/C/3.md', sessionId: 's1', turnId: '2' })
  assert.deepEqual(second.relates, [])
  assert.ok(second.trace.some((event) => event.provider === 'crumbs' && event.status === 'skipped' && event.reason.includes('already injected this session')))
})

test('a file mention and its containing directory mention share one subject group', async () => {
  const runner = new PromptMiddlewareRunner()
  runner.registerRelates(relatesProvider({
    name: 'crumbs',
    kind: 'breadcrumb-description',
    subjectOf: (p) => (p.kind === 'file' ? (p.path.split('/').slice(0, -1).join('/') || p.path) : p.path),
    resolve: async () => ({ value: 'ancestor chain' }),
  }))
  const result = await runPaths(runner, [
    { path: 'A/B/C/1.md', kind: 'file', origin: 'prompt-parse' },
    { path: 'A/B/C', kind: 'directory', origin: 'prompt-parse' },
  ])
  // 文件与其所在目录的提及渲染为同一分组：同 key（A/B/C）同值，一条 item。
  assert.deepEqual(result.relates, [
    { path: 'A/B/C', items: [{ kind: 'breadcrumb-description', label: 'breadcrumb-description', value: 'ancestor chain' }] },
  ])
  assert.equal((result.text?.match(/\[breadcrumb-description\]/gu) ?? []).length, 1)
})

test('group order follows first mention, then provider order; subject groups keep band order', async () => {
  const runner = new PromptMiddlewareRunner()
  runner.registerRelates(relatesProvider({
    name: 'link', kind: 'cognition-link', priority: 10,
    resolve: async ({ path }) => ({ href: `cog/${path.path}` }),
  }))
  runner.registerRelates(relatesProvider({
    name: 'crumb', kind: 'breadcrumb-description', priority: 100,
    subjectOf: (p) => (p.kind === 'file' ? (p.path.split('/').slice(0, -1).join('/') || p.path) : p.path),
    resolve: async () => ({ value: 'chain' }),
  }))
  const result = await runPaths(runner, [
    { path: 'A/one.md', kind: 'file', origin: 'prompt-parse' },
    { path: 'B/two.md', kind: 'file', origin: 'prompt-parse' },
  ])
  assert.deepEqual(result.relates.map((group) => group.path), ['A/one.md', 'A', 'B/two.md', 'B'])
})

test('subjectOf outside the mention ancestry fails the provider loud', async () => {
  const runner = new PromptMiddlewareRunner()
  runner.registerRelates(relatesProvider({
    name: 'bad-subject', kind: 'k',
    subjectOf: () => 'elsewhere/x',
    resolve: async () => ({ value: 'v' }),
  }))
  const result = await runOne(runner, { path: 'a.md' })
  assert.deepEqual(result.relates, [])
  assert.ok(result.trace.some((event) => event.provider === 'bad-subject' && event.status === 'failed' && event.reason.includes('subjectOf')))
})

test('declarative provider rejects a non-function subjectOf at registration', () => {
  const runner = new PromptMiddlewareRunner()
  assert.throws(() => runner.registerRelates(relatesProvider({ subjectOf: 'docs' })), /subjectOf must be a function/)
})

test('undefined or empty value yields no contribution and does not disturb other providers', async () => {
  const runner = new PromptMiddlewareRunner()
  runner.registerRelates(relatesProvider({
    name: 'skip',
    kind: 'skip-kind',
    resolve: async ({ path }) => (path.path === 'a.md' ? undefined : { value: '' }),
  }))
  runner.registerRelates(relatesProvider({
    name: 'keep',
    kind: 'keep-kind',
    resolve: async ({ path }) => ({ value: `v:${path.path}` }),
  }))
  const result = await runPaths(runner, [
    { path: 'a.md', kind: 'file', origin: 'prompt-parse' },
    { path: 'b.md', kind: 'file', origin: 'prompt-parse' },
  ])
  assert.deepEqual(result.relates, [
    { path: 'a.md', items: [{ kind: 'keep-kind', label: 'keep-kind', value: 'v:a.md' }] },
    { path: 'b.md', items: [{ kind: 'keep-kind', label: 'keep-kind', value: 'v:b.md' }] },
  ])
})

test("mode 'always' injects every turn while the default once does not", async () => {
  const runner = new PromptMiddlewareRunner()
  runner.registerRelates(relatesProvider({
    name: 'always-on',
    kind: 'always',
    mode: 'always',
    resolve: async () => ({ value: 'fresh' }),
  }))
  const first = await runOne(runner, { path: 'a.md', sessionId: 's1' })
  const second = await runOne(runner, { path: 'a.md', sessionId: 's1' })
  assert.equal(first.relates[0].items[0].value, 'fresh')
  assert.equal(second.relates[0].items[0].value, 'fresh')
})

test('priority and timeoutMs pass through to list() and ordering', () => {
  const runner = new PromptMiddlewareRunner()
  runner.registerRelates(relatesProvider({
    name: 'late', kind: 'k', priority: 10, timeoutMs: 500,
    resolve: async () => ({ value: 'late' }),
  }))
  runner.registerRelates(relatesProvider({
    name: 'early', kind: 'k', priority: 1,
    resolve: async () => ({ value: 'early' }),
  }))
  const list = runner.list()
  assert.deepEqual(list.map((provider) => provider.name), ['early', 'late'])
  assert.equal(list[0].timeoutMs, undefined)
  assert.equal(list[1].timeoutMs, 500)
  assert.equal(list[0].mode, 'once')
})

test('resolver failure marks the provider failed and keeps later providers running', async () => {
  const runner = new PromptMiddlewareRunner()
  runner.registerRelates(relatesProvider({
    name: 'boom',
    kind: 'boom',
    resolve: async () => { throw new Error('exploded') },
  }))
  runner.registerRelates(relatesProvider({
    name: 'after',
    kind: 'after',
    resolve: async () => ({ value: 'ok' }),
  }))
  const result = await runOne(runner, { path: 'a.md' })
  assert.deepEqual(result.relates[0].items, [{ kind: 'after', label: 'after', value: 'ok' }])
  assert.ok(result.trace.some((event) => event.provider === 'boom' && event.status === 'failed' && event.reason === 'exploded'))
})

test('duplicate declarative name fails loud', () => {
  const runner = new PromptMiddlewareRunner()
  runner.registerRelates(relatesProvider({ name: 'dup' }))
  assert.throws(() => runner.registerRelates(relatesProvider({ name: 'dup' })), /already registered/)
})

test('invalid declarative name fails loud', () => {
  const runner = new PromptMiddlewareRunner()
  assert.throws(() => runner.registerRelates(relatesProvider({ name: 'BadName' })), /must match/)
})

test('declarative provider rejects an empty kind at registration', () => {
  const runner = new PromptMiddlewareRunner()
  assert.throws(() => runner.registerRelates(relatesProvider({ kind: '' })), /kind must be a non-empty string/)
})

test("declarative provider rejects an explicit 'once' mode", () => {
  const runner = new PromptMiddlewareRunner()
  assert.throws(() => runner.registerRelates(relatesProvider({ mode: 'once' })), /mode must be 'always' or omitted/)
})

test('empty path list never calls resolve and injects nothing', async () => {
  let called = false
  const runner = new PromptMiddlewareRunner()
  runner.registerRelates(relatesProvider({
    name: 'never',
    kind: 'k',
    resolve: async () => {
      called = true
      return { value: 'x' }
    },
  }))
  const result = await runner.run({
    prompt: 'nope',
    paths: [],
    agent: {},
    cwd: '.',
    turnId: '1',
    signal: new AbortController().signal,
  })
  assert.equal(called, false)
  assert.deepEqual(result.relates, [])
  assert.equal(result.text, undefined)
})
