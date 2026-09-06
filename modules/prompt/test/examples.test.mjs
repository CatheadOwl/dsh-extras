// Anti-bitrot smoke for the frozen examples: registers each specimen on a
// real runner and asserts the behavior the cookbook teaches — in particular
// the reconciliation ordering ("自编辑是推迟，不是吞掉").
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PromptMiddlewareRunner } from '../lib/core.js'
import { pairedNoteProvider } from '../examples/paired-note/provider.mjs'

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

test('paired-note specimen: prompt mention injects, self-edit stays silent, next read surfaces', async () => {
  // In-memory pair state: the note derives from the file, so an edit bumps version.
  const state = new Map([['docs/a.md', { version: 'v1', note: 'note for v1' }]])
  const loadPairState = async path => state.get(path)

  const runner = new PromptMiddlewareRunner()
  runner.registerRelates(pairedNoteProvider({ loadPairState }))

  // 1. Prompt mention → injects v1.
  const run1 = await runner.run(baseOptions({ paths: [promptPath('docs/a.md')] }))
  assert.ok(run1.text?.includes('note for v1'))

  // 2. Self-edit: derived state flips to v2 with the edit; the edit touch's
  //    re-offer must stay silent — and must NOT advance the seen-record.
  state.set('docs/a.md', { version: 'v2', note: 'note for v2' })
  runner.recordTouch('s1', { path: 'docs/a.md', tool: 'edit' }, { cwd: '/proj' })
  const run2 = await runner.run(baseOptions({ touches: [{ path: 'docs/a.md', tool: 'edit' }] }))
  assert.equal(run2.text, undefined, 'reconciliation narrates nothing back')

  // 3. Next organic read: the gap between seen (v1) and reality (v2) settles —
  //    the note surfaces. If the specimen's edit branch had advanced the
  //    record, this would be the swallow: silent forever.
  const run3 = await runner.run(baseOptions({ touches: [{ path: 'docs/a.md', tool: 'read' }] }))
  assert.ok(run3.text?.includes('note for v2'), 'the deferred signal surfaces on the next organic contact')

  // 4. Steady state: another read with no further change says nothing.
  const run4 = await runner.run(baseOptions({ touches: [{ path: 'docs/a.md', tool: 'read' }] }))
  assert.equal(run4.text, undefined)
})

test('paired-note specimen: formatNote override shapes the injected value', async () => {
  const state = new Map([['docs/b.md', { version: 'v1', note: 'raw' }]])
  const runner = new PromptMiddlewareRunner()
  runner.registerRelates(pairedNoteProvider({
    loadPairState: async path => state.get(path),
    formatNote: s => `[${s.version}] ${s.note}`,
  }))
  const run = await runner.run(baseOptions({ paths: [promptPath('docs/b.md')] }))
  assert.ok(run.text?.includes('[v1] raw'))
})
