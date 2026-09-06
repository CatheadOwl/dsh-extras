// Touch-lane integration semantics at the runner level: subscription
// filtering, pseudo-path materialization, cross-source once dedupe, ledger
// invalidation on record, and the registration-time dead-subscription guard.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PromptMiddlewareRunner } from '../lib/core.js'

function promptPath(path) {
  return { path, kind: 'file', origin: 'prompt-parse' }
}

function baseOptions(overrides = {}) {
  return {
    prompt: '',
    paths: [],
    agent: {},
    sessionId: 's1',
    cwd: '/proj',
    turnId: 't1',
    ...overrides,
  }
}

test('a touch-subscribed provider receives pseudo-paths from its own projection', async () => {
  const seen = []
  const runner = new PromptMiddlewareRunner()
  runner.registerRelates({
    name: 'touch-consumer',
    kind: 'note',
    sources: ['prompt', 'touch'],
    touchSubjects: path => (path === 'src/a.ts' ? ['src/a.ts'] : []),
    async resolve({ path }) {
      seen.push({ path: path.path, origin: path.origin, touchTool: path.touchTool })
      return { value: `note for ${path.path}` }
    },
  })
  const result = await runner.run(baseOptions({
    paths: [promptPath('docs/readme.md')],
    touches: [{ path: 'src/a.ts', tool: 'read' }],
  }))
  assert.deepEqual(seen, [
    { path: 'docs/readme.md', origin: 'prompt-parse', touchTool: undefined },
    { path: 'src/a.ts', origin: 'touch', touchTool: 'read' },
  ], 'prompt paths first, then touch pseudo-paths carrying provenance')
  assert.ok(result.text.includes('src/a.ts:'), 'touch subject renders as its own group')
  assert.ok(result.trace.some(event => event.provider === 'touch-consumer' && event.source === 'touch'))
})

test('a prompt-only provider (default) never receives touch pseudo-paths', async () => {
  const seen = []
  const runner = new PromptMiddlewareRunner()
  runner.registerRelates({
    name: 'prompt-only',
    kind: 'note',
    async resolve({ path }) {
      seen.push(path.path)
      return { value: 'x' }
    },
  })
  await runner.run(baseOptions({
    paths: [promptPath('docs/readme.md')],
    touches: [{ path: 'src/a.ts', tool: 'read' }],
  }))
  assert.deepEqual(seen, ['docs/readme.md'])
})

test('a touch-only provider receives pseudo-paths and no prompt paths', async () => {
  const seen = []
  const runner = new PromptMiddlewareRunner()
  runner.registerRelates({
    name: 'touch-only',
    kind: 'note',
    sources: ['touch'],
    touchSubjects: path => [path],
    async resolve({ path }) {
      seen.push(path.origin)
      return { value: 'x' }
    },
  })
  await runner.run(baseOptions({
    paths: [promptPath('docs/readme.md')],
    touches: [{ path: 'src/a.ts', tool: 'edit' }],
  }))
  assert.deepEqual(seen, ['touch'])
})

test('cross-source once dedupe: a prompt-injected subject suppresses the later touch', async () => {
  let calls = 0
  const runner = new PromptMiddlewareRunner()
  runner.registerRelates({
    name: 'dedupe',
    kind: 'note',
    sources: ['prompt', 'touch'],
    touchSubjects: path => [path],
    async resolve() {
      calls += 1
      return { value: 'x' }
    },
  })
  await runner.run(baseOptions({ paths: [promptPath('src/a.ts')] }))
  assert.equal(calls, 1)
  const result = await runner.run(baseOptions({ touches: [{ path: 'src/a.ts', tool: 'read' }] }))
  assert.equal(calls, 1, 'ledger hit: resolve not re-run for the same key')
  assert.ok(result.trace.some(event => event.reason === 'all paths already injected this session'))
  assert.equal(result.text, undefined)
})

test('invalidation closes the loop: edit re-runs resolve, undefined renders nothing and re-arms nothing', async () => {
  const values = [{ value: 'first' }, undefined, { value: 'third' }]
  let calls = 0
  const runner = new PromptMiddlewareRunner()
  runner.registerRelates({
    name: 'chatter',
    kind: 'note',
    sources: ['prompt', 'touch'],
    touchSubjects: path => [path],
    async resolve() {
      calls += 1
      return values[calls - 1]
    },
  })
  const run1 = await runner.run(baseOptions({ paths: [promptPath('src/a.ts')] }))
  assert.ok(run1.text !== undefined, 'prompt mention injects and ledgers')
  runner.recordTouch('s1', { path: 'src/a.ts', tool: 'edit' })
  const run2 = await runner.run(baseOptions({ touches: [{ path: 'src/a.ts', tool: 'edit' }] }))
  assert.equal(calls, 2, 'invalidation re-ran resolve for the touched subject')
  assert.equal(run2.text, undefined, 'undefined resolve renders nothing')
  // Chatter resolution: the undefined pass re-ledgered nothing, so the next
  // touch re-runs resolve (steady state = one cheap query per touch, zero
  // injection while nothing changed).
  const run3 = await runner.run(baseOptions({ touches: [{ path: 'src/a.ts', tool: 'edit' }] }))
  assert.equal(calls, 3)
  assert.ok(run3.text !== undefined, 'a changed value injects again after the re-run')
})

test('invalidation runs for declarers regardless of touch subscription', async () => {
  let calls = 0
  const runner = new PromptMiddlewareRunner()
  // Prompt-only consumer that still declares the reverse projection: it never
  // receives touch pseudo-paths, but its ledger entries still invalidate.
  runner.registerRelates({
    name: 'prompt-side-declarer',
    kind: 'note',
    touchSubjects: path => [path],
    async resolve() {
      calls += 1
      return { value: 'x' }
    },
  })
  await runner.run(baseOptions({ paths: [promptPath('src/a.ts')] }))
  assert.equal(calls, 1)
  runner.recordTouch('s1', { path: 'src/a.ts', tool: 'edit' })
  await runner.run(baseOptions({ paths: [promptPath('src/a.ts')] }))
  assert.equal(calls, 2, 'the touch removed the key even though the provider never subscribed to touch input')
})

test('subjectOf is never applied to touch pseudo-paths — the subject keys as itself', async () => {
  const groups = []
  const runner = new PromptMiddlewareRunner()
  runner.registerRelates({
    name: 'projection',
    kind: 'note',
    sources: ['prompt', 'touch'],
    subjectOf: path => (path.path === 'docs/guide.md' ? 'docs' : path.path),
    touchSubjects: path => [path],
    async resolve({ path }) {
      return { value: `for ${path.path}` }
    },
  })
  const result = await runner.run(baseOptions({ touches: [{ path: 'docs/guide.md', tool: 'read' }] }))
  for (const group of result.relates) groups.push(group.path)
  assert.deepEqual(groups, ['docs/guide.md'], 'touch anchor keys as the subject itself, not the subjectOf ancestor')
  // Mirror semantics: the prompt side keys through subjectOf (docs/guide.md
  // → 'docs'), the touch side keys as the subject — distinct keys unless the
  // provider's two declarations land on the same subject space.
  const result2 = await runner.run(baseOptions({ paths: [promptPath('docs/guide.md')] }))
  assert.ok(result2.text !== undefined, 'prompt mention keys through subjectOf and does not hit the touch-written key')
})

test('a dead subscription (touch source without touchSubjects) fails loud at registration', () => {
  const runner = new PromptMiddlewareRunner()
  assert.throws(
    () => runner.registerRelates({ name: 'dead', kind: 'note', sources: ['prompt', 'touch'], async resolve() { return undefined } }),
    /touchSubjects/,
  )
  assert.throws(
    () => runner.register({ name: 'dead-imperative', sources: ['touch'], async run() { return [] } }),
    /touchSubjects/,
  )
})

test('touchSubjects must be a function and sources entries must be valid', () => {
  const runner = new PromptMiddlewareRunner()
  assert.throws(
    () => runner.register({ name: 'bad-projection', sources: ['prompt', 'touch'], touchSubjects: 'nope', async run() { return [] } }),
    /touchSubjects must be a function/,
  )
  assert.throws(
    () => runner.register({ name: 'bad-source', sources: ['prompt', 'telepathy'], async run() { return [] } }),
    /'prompt' or 'touch'/,
  )
  assert.throws(
    () => runner.register({ name: 'empty-source', sources: [], async run() { return [] } }),
    /non-empty array/,
  )
})

test('touch anchors dedupe within a provider when touchSubjects repeats a subject', async () => {
  const seen = []
  const runner = new PromptMiddlewareRunner()
  runner.registerRelates({
    name: 'dupe-anchor',
    kind: 'note',
    sources: ['touch'],
    touchSubjects: () => ['src/a.ts', 'src/a.ts', 'src/a.ts'],
    async resolve({ path }) {
      seen.push(path.path)
      return { value: 'x' }
    },
  })
  await runner.run(baseOptions({ touches: [{ path: 'src/anything.md', tool: 'read' }] }))
  assert.deepEqual(seen, ['src/a.ts'])
})

test('an empty touchSubjects projection offers nothing and records no ledger noise', async () => {
  let calls = 0
  const runner = new PromptMiddlewareRunner()
  runner.registerRelates({
    name: 'unpaired',
    kind: 'note',
    sources: ['touch'],
    touchSubjects: () => [],
    async resolve() {
      calls += 1
      return { value: 'x' }
    },
  })
  const result = await runner.run(baseOptions({ touches: [{ path: 'unrelated/x.md', tool: 'read' }] }))
  assert.equal(calls, 0, 'unpaired touch never reaches resolve — flood control lives in the projection')
  assert.equal(result.text, undefined)
  assert.deepEqual(result.trace, [], 'no provider execution happened, so no trace row either')
})

test('an empty consumption batch runs no provider and traces nothing', async () => {
  let calls = 0
  const runner = new PromptMiddlewareRunner()
  runner.registerRelates({
    name: 'default-consumer',
    kind: 'note',
    async resolve() {
      calls += 1
      return { value: 'x' }
    },
  })
  // Touch-only step, and the (only) provider never subscribed to touch.
  const result = await runner.run(baseOptions({ touches: [{ path: 'src/a.ts', tool: 'read' }] }))
  assert.equal(calls, 0)
  assert.deepEqual(result.trace, [])
})

test('a throwing touchSubjects at consumption becomes that provider\'s failed trace only', async () => {
  let goodCalls = 0
  const runner = new PromptMiddlewareRunner()
  runner.registerRelates({
    name: 'bad-projection',
    kind: 'note',
    sources: ['touch'],
    touchSubjects: () => { throw new Error('projection bug') },
    async resolve() {
      goodCalls += 1
      return { value: 'x' }
    },
  })
  runner.registerRelates({
    name: 'good-projection',
    kind: 'note',
    sources: ['prompt', 'touch'],
    touchSubjects: path => [path],
    async resolve() {
      goodCalls += 1
      return { value: 'ok' }
    },
  })
  const result = await runner.run(baseOptions({
    paths: [promptPath('docs/readme.md')],
    touches: [{ path: 'src/a.ts', tool: 'read' }],
  }))
  assert.ok(result.text !== undefined, 'the healthy declarer still contributes')
  const failed = result.trace.find(event => event.provider === 'bad-projection')
  assert.equal(failed?.status, 'failed')
  assert.equal(failed?.source, 'touch')
  assert.ok(failed?.reason?.includes('projection bug'))
  assert.equal(goodCalls, 2, 'both providers\' resolves ran; only the broken projection sat out')
})

test('toggle × touch: a disabled provider still invalidates, consumes nothing, and skips without ledger writes', async () => {
  let calls = 0
  const runner = new PromptMiddlewareRunner()
  runner.registerRelates({
    name: 'switched-off',
    kind: 'note',
    sources: ['prompt', 'touch'],
    touchSubjects: path => [path],
    async resolve() {
      calls += 1
      return { value: 'x' }
    },
  })
  const disabled = new Set(['switched-off'])
  // Turn 1: provider off — no execution, no ledger marks.
  await runner.run(baseOptions({ paths: [promptPath('src/a.ts')], disabled }))
  assert.equal(calls, 0)
  // While off, a touch still removes the (nonexistent) ledger entry — and
  // crucially does not add one.
  runner.recordTouch('s1', { path: 'src/a.ts', tool: 'edit' })
  // Turn 2: still off, consumes the pending touch without executing.
  const offResult = await runner.run(baseOptions({ touches: [{ path: 'src/a.ts', tool: 'edit' }], disabled }))
  assert.equal(calls, 0)
  assert.equal(offResult.text, undefined)
  assert.ok(offResult.trace.some(event => event.provider === 'switched-off' && event.status === 'skipped' && event.reason === 'disabled by user'))
  // Turn 3: re-enabled — nothing was ever ledgered, so the touch subject injects.
  const onResult = await runner.run(baseOptions({ paths: [promptPath('src/a.ts')] }))
  assert.equal(calls, 1)
  assert.ok(onResult.text !== undefined)
})
