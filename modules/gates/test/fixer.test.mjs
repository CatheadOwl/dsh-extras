import assert from 'node:assert/strict'
import { test } from 'node:test'

import { dispatchFixer } from '../lib/fixer.js'

/** One defer-level command-fixer failure; the command branch never reads `result`. */
function commandFailure() {
  return [{
    definition: {
      id: 'cmd-fix',
      description: 'command fixer gate',
      rationale: 'why',
      on: ['stop', 'manual'],
      level: 'defer',
      fixer: { kind: 'command', command: 'node scripts/fix.mjs' },
      check: async () => [],
    },
    result: { gateId: 'cmd-fix', status: 'failed', durationMs: 1, violations: [] },
  }]
}

/** Dispatch one command failure through a stubbed command runner (no subprocess). */
function run(runCommand) {
  return dispatchFixer({}, commandFailure(), {
    agent: {},
    signal: new AbortController().signal,
    root: '.',
    runCommand,
  })
}

test('dispatchFixer calls the command fixer and forwards runCommand args', async () => {
  const calls = []
  const stub = async (command, root, timeoutMs, changes) => {
    calls.push({ command, root, timeoutMs, changes })
    return { exitCode: 0, output: '', timedOut: false }
  }
  await run(stub)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, 'node scripts/fix.mjs')
  assert.equal(calls[0].root, '.')
  assert.equal(calls[0].timeoutMs, 120_000, 'command fixers run under the fixed safety-bound timeout')
  assert.equal(calls[0].changes, undefined, 'command fixers receive no change set')
})

test('dispatchFixer does not throw on nonzero exit, timeout, or rejected command', async () => {
  await assert.doesNotReject(
    run(async () => ({ exitCode: 3, output: '', timedOut: false })),
    'nonzero exit does not throw',
  )
  await assert.doesNotReject(
    run(async () => ({ exitCode: null, output: '', timedOut: true })),
    'timeout does not throw',
  )
  await assert.doesNotReject(
    run(async () => { throw new Error('boom') }),
    'a rejected command run does not throw',
  )
})
