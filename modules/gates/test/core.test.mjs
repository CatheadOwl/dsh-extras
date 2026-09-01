import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildFixerPrompt,
  collectBlockingFailures,
  collectDeferredFailures,
  createGateRegistry,
  formatGateFailureFeedback,
  formatGateSummary,
  nextBlockBudget,
  runGate,
  runGates,
  selectGates,
  validateGateId,
} from '../lib/core.js'

function gate(overrides) {
  return {
    id: 'demo',
    description: 'demo gate',
    rationale: 'demo rationale',
    on: ['stop', 'manual'],
    level: 'blocking',
    check: async () => [],
    ...overrides,
  }
}

test('validateGateId accepts kebab-case and rejects everything else', () => {
  validateGateId('doc-sync')
  validateGateId('coggit-misplaced')
  assert.throws(() => validateGateId('DocSync'), /must match/)
  assert.throws(() => validateGateId('9lead'), /must match/)
  assert.throws(() => validateGateId('has space'), /must match/)
  assert.throws(() => validateGateId('gates-config'), /reserved/)
})

test('registry registers, lists in order, gets by id, and fails loud on duplicates', () => {
  const registry = createGateRegistry()
  const first = gate({ id: 'first' })
  const second = gate({ id: 'second' })
  registry.register(first)
  registry.register(second)
  assert.deepEqual(registry.list().map(item => item.id), ['first', 'second'])
  assert.equal(registry.get('first'), first)
  assert.equal(registry.get('missing'), undefined)
  assert.throws(() => registry.register(gate({ id: 'first' })), /already registered/)
})

test('registry fails loud on unknown trigger or level vocabulary', () => {
  const registry = createGateRegistry()
  assert.throws(() => registry.register(gate({ id: 'bad-trigger', on: ['stop', 'always'] })), /unknown trigger/)
  assert.throws(() => registry.register(gate({ id: 'bad-level', level: 'Blocking' })), /unknown level/)
})

test('registry fails loud on a fixer declared on a non-defer gate', () => {
  const registry = createGateRegistry()
  assert.throws(
    () => registry.register(gate({ id: 'blocking-fixer', level: 'blocking', fixer: { kind: 'subagent', prompt: 'fix it' } })),
    /fixer.*defer/,
  )
})

test('registry fails loud on an unknown fixer kind', () => {
  const registry = createGateRegistry()
  assert.throws(
    () => registry.register(gate({ id: 'bad-fixer', level: 'defer', fixer: { kind: 'spawn' } })),
    /unknown fixer kind/,
  )
})

test('registry fails loud on a subagent fixer with a missing or empty prompt', () => {
  const registry = createGateRegistry()
  assert.throws(
    () => registry.register(gate({ id: 'empty-prompt', level: 'defer', fixer: { kind: 'subagent', prompt: '' } })),
    /missing or empty prompt/,
  )
  assert.throws(
    () => registry.register(gate({ id: 'null-prompt', level: 'defer', fixer: { kind: 'subagent', prompt: null } })),
    /missing or empty prompt/,
  )
})

test('registry fails loud on a command fixer with a missing or empty command', () => {
  const registry = createGateRegistry()
  assert.throws(
    () => registry.register(gate({ id: 'empty-command', level: 'defer', fixer: { kind: 'command', command: '' } })),
    /missing or empty command/,
  )
  assert.throws(
    () => registry.register(gate({ id: 'null-command', level: 'defer', fixer: { kind: 'command', command: null } })),
    /missing or empty command/,
  )
})

test('registry accepts a well-formed command fixer on a defer gate', () => {
  const registry = createGateRegistry()
  registry.register(gate({ id: 'cmd-fixer', level: 'defer', fixer: { kind: 'command', command: 'node scripts/fix.mjs' } }))
  assert.equal(registry.get('cmd-fixer').fixer.command, 'node scripts/fix.mjs')
})

test('registry rejects an unknown request field on a subagent fixer', () => {
  const registry = createGateRegistry()
  assert.throws(
    () => registry.register(gate({ id: 'bad-request', level: 'defer', fixer: { kind: 'subagent', prompt: 'fix', request: { depth: 2 } } })),
    /unknown field "depth"/,
  )
})

test('registry rejects a non-mapping request on a subagent fixer', () => {
  const registry = createGateRegistry()
  assert.throws(
    () => registry.register(gate({ id: 'null-request', level: 'defer', fixer: { kind: 'subagent', prompt: 'fix', request: null } })),
    /request.*not a mapping/,
  )
  assert.throws(
    () => registry.register(gate({ id: 'scalar-request', level: 'defer', fixer: { kind: 'subagent', prompt: 'fix', request: 5 } })),
    /request.*not a mapping/,
  )
})

test('registry accepts the whitelisted request fields on a subagent fixer', () => {
  const registry = createGateRegistry()
  registry.register(gate({
    id: 'full-request',
    level: 'defer',
    fixer: {
      kind: 'subagent',
      prompt: 'fix',
      request: { provider: 'spawn', persona: 'p', toolFilter: { allow: ['read'] }, agentOptions: { model: 'm' } },
    },
  }))
  assert.equal(registry.get('full-request').fixer.kind, 'subagent')
})

test('registry disposer unregisters exactly the registered definition', () => {
  const registry = createGateRegistry()
  const dispose = registry.register(gate({ id: 'demo' }))
  dispose()
  assert.deepEqual(registry.list(), [])
  // Idempotent dispose; re-registration works afterwards.
  dispose()
  registry.register(gate({ id: 'demo' }))
  assert.equal(registry.list().length, 1)
})

test('selectGates filters by opted-in trigger and keeps order', () => {
  const stopOnly = gate({ id: 'stop-only', on: ['stop'] })
  const manualOnly = gate({ id: 'manual-only', on: ['manual'] })
  const both = gate({ id: 'both' })
  assert.deepEqual(selectGates([stopOnly, manualOnly, both], 'stop').map(item => item.id), ['stop-only', 'both'])
  assert.deepEqual(selectGates([stopOnly, manualOnly, both], 'manual').map(item => item.id), ['manual-only', 'both'])
})

test('runGate passes on no violations and fails with violations', async () => {
  const passed = await runGate(gate({ id: 'clean' }), '/tmp/root')
  assert.equal(passed.status, 'passed')
  assert.deepEqual(passed.violations, [])
  assert.equal(typeof passed.durationMs, 'number')

  const violation = { file: 'a.md', line: 2, reason: 'broken' }
  const failed = await runGate(gate({ id: 'dirty', check: async () => [violation] }), '/tmp/root')
  assert.equal(failed.status, 'failed')
  assert.deepEqual(failed.violations, [violation])
})

test('runGate forwards the session change set to check', async () => {
  let seen
  const g = gate({ id: 'sees-changes', check: async (_root, changes) => { seen = changes; return [] } })
  const changes = { paths: ['a.md', 'b.ts'], opaque: false }
  const result = await runGate(g, '/tmp/root', { changes })
  assert.equal(result.status, 'passed')
  assert.deepEqual(seen, changes)
})

test('runGates forwards the session change set to every check', async () => {
  const seen = []
  const changes = { paths: ['a.md'], opaque: true }
  const make = id => gate({ id, check: async (_root, received) => { seen.push([id, received]); return [] } })
  await runGates([make('a'), make('b')], '.', { changes })
  assert.deepEqual(seen, [['a', changes], ['b', changes]])
})

test('runGate contains thrown check errors as failed results', async () => {
  const result = await runGate(gate({ id: 'boom', check: async () => { throw new Error('check exploded') } }), '.')
  assert.equal(result.status, 'failed')
  assert.equal(result.error, 'check exploded')
  assert.deepEqual(result.violations, [])
})

test('runGate fails with an attributable error when the check exceeds timeoutMs', async () => {
  const slow = gate({ id: 'slow', timeoutMs: 20, check: () => new Promise(() => {}) })
  const result = await runGate(slow, '.')
  assert.equal(result.status, 'failed')
  assert.match(result.error, /timed out after 20ms/)
})

test('runGates skips remaining gates once the signal is aborted', async () => {
  const controller = new AbortController()
  const make = id => gate({ id, check: async () => { if (id === 'a') controller.abort(); return [] } })
  const results = await runGates([make('a'), make('b')], '.', { signal: controller.signal })
  assert.equal(results[0].status, 'passed')
  assert.equal(results[1].status, 'skipped')
  assert.match(results[1].error, /aborted/)
})

test('runGates runs serially in registration order', async () => {
  const order = []
  const make = id => gate({ id, check: async () => { order.push(id); return [] } })
  const results = await runGates([make('a'), make('b'), make('c')], '.')
  assert.deepEqual(order, ['a', 'b', 'c'])
  assert.deepEqual(results.map(result => result.gateId), ['a', 'b', 'c'])
})

test('collectBlockingFailures keeps only blocking failures', () => {
  const blocking = gate({ id: 'blocking', level: 'blocking' })
  const advisory = gate({ id: 'advisory', level: 'advisory' })
  const results = [
    { gateId: 'blocking', status: 'failed', durationMs: 1, violations: [{ reason: 'x' }] },
    { gateId: 'advisory', status: 'failed', durationMs: 1, violations: [{ reason: 'y' }] },
    { gateId: 'blocking', status: 'passed', durationMs: 1, violations: [] },
  ]
  const failures = collectBlockingFailures([blocking, advisory], results)
  assert.equal(failures.length, 1)
  assert.equal(failures[0].definition.id, 'blocking')
})

test('collectDeferredFailures keeps only defer-level failures', () => {
  const blocking = gate({ id: 'blocking', level: 'blocking' })
  const advisory = gate({ id: 'advisory', level: 'advisory' })
  const deferred = gate({ id: 'deferred', level: 'defer' })
  const results = [
    { gateId: 'blocking', status: 'failed', durationMs: 1, violations: [{ reason: 'x' }] },
    { gateId: 'advisory', status: 'failed', durationMs: 1, violations: [{ reason: 'y' }] },
    { gateId: 'deferred', status: 'failed', durationMs: 1, violations: [{ reason: 'z' }] },
    { gateId: 'deferred', status: 'passed', durationMs: 1, violations: [] },
  ]
  const failures = collectDeferredFailures([blocking, advisory, deferred], results)
  assert.equal(failures.length, 1)
  assert.equal(failures[0].definition.id, 'deferred')
})

test('nextBlockBudget steers under max, degrades at max, and resets on pass', () => {
  assert.deepEqual(nextBlockBudget(0, false, 3), { steer: false, count: 0, degraded: false })
  assert.deepEqual(nextBlockBudget(0, true, 3), { steer: true, count: 1, degraded: false })
  assert.deepEqual(nextBlockBudget(2, true, 3), { steer: true, count: 3, degraded: false })
  assert.deepEqual(nextBlockBudget(3, true, 3), { steer: false, count: 0, degraded: true })
  // A pass after degradation resets the cycle.
  assert.deepEqual(nextBlockBudget(0, false, 3), { steer: false, count: 0, degraded: false })
})

test('formatGateFailureFeedback carries rationale, locations, and remedies', () => {
  const definition = gate({
    id: 'doc-sync',
    description: 'doc refs',
    rationale: 'why docs must resolve',
  })
  const result = {
    gateId: 'doc-sync',
    status: 'failed',
    durationMs: 5,
    violations: [
      { file: 'a.md', line: 3, reason: 'broken link', remedy: { kind: 'manual', guidance: 'edit the ref' } },
      { reason: 'no location', remedy: { kind: 'operation', operation: 'refactor' } },
    ],
  }
  const text = formatGateFailureFeedback([{ definition, result }])
  assert.ok(text.includes('1 blocking gate(s) failed'))
  assert.ok(text.includes('## gate: doc-sync'))
  assert.ok(text.includes('why docs must resolve'))
  assert.ok(text.includes('- a.md:3: broken link'))
  assert.ok(text.includes('fix: edit the ref'))
  assert.ok(text.includes('fix: run repair operation "refactor"'))
})

test('formatGateFailureFeedback caps the reported violations', () => {
  const definition = gate({ id: 'many' })
  const violations = Array.from({ length: 25 }, (_, index) => ({ reason: `problem ${index}` }))
  const text = formatGateFailureFeedback([{ definition, result: { gateId: 'many', status: 'failed', durationMs: 1, violations } }])
  assert.ok(text.includes('...and 5 more'))
  assert.ok(!text.includes('problem 20'))
})

test('formatGateSummary renders one line per gate', () => {
  const summary = formatGateSummary([
    { gateId: 'a', status: 'passed', durationMs: 10, violations: [] },
    { gateId: 'b', status: 'failed', durationMs: 20, violations: [{ reason: 'x' }, { reason: 'y' }] },
    { gateId: 'c', status: 'failed', durationMs: 30, violations: [], error: 'spawn failed' },
  ])
  const lines = summary.split('\n')
  assert.match(lines[0], /^PASS a /)
  assert.match(lines[1], /^FAILED b .*2 violation\(s\)/)
  assert.match(lines[2], /^FAILED c .*error: spawn failed/)
})

test('buildFixerPrompt appends the deduplicated failed file list with reasons', () => {
  const fixer = { kind: 'subagent', prompt: 'Read each file and add a description.' }
  const failures = [{
    definition: gate({ id: 'md-metadata' }),
    result: {
      gateId: 'md-metadata',
      status: 'failed',
      durationMs: 1,
      violations: [
        { file: 'a.md', line: 1, reason: 'missing description' },
        { file: 'b.md', line: 1, reason: 'missing description' },
        { file: 'a.md', line: 2, reason: 'empty description' },
      ],
    },
  }]
  const text = buildFixerPrompt(fixer, failures)
  assert.ok(text.startsWith('Read each file and add a description.'))
  assert.ok(text.includes('- a.md — missing description'))
  assert.ok(text.includes('- b.md — missing description'))
  // a.md appears exactly once (deduplicated, first reason wins).
  assert.equal(text.split('a.md').length - 1, 1)
  assert.ok(!text.includes('empty description'))
})
