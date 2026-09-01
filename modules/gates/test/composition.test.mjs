// Real composition test: boots the gates plugin over a mock agent loop and
// exercises the `agent/turn-stopping` driver end-to-end — the defer "旁路"
// (fixer dispatch off-turn + dirty-window persistence), the blocking
// consecutive-block budget (steer-then-degrade), the stop-dimension switch,
// and the W10 turn-end attribution filter (one driver test per clause:
// source ∈ W isolation / opaque → true / target ∈ W).
//
// Unlike the rest of the suite, this test DOES import the dsh host's
// `@deepseek-ai/*` packages (through the plugin's local junctions) and a Cordis
// process, because the driver under test only runs at `agent/turn-stopping`.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as fork from '@deepseek-ai/dsh-subagent-fork-in-process'

import * as gates from '../lib/index.js'

// The real doc-link gate data plane, now shipped inside the extras md module
// plugin (`dsh-plugin-dev/md-links-gates`, formerly `scripts/doc-link-lib.mjs`):
// the same `check(root, changes)` surface the plugin's registerGate definition
// and the module-gate form load.
import { check as docLinkCheck } from '../../md/lib/gate-check.js'

/** Scripted text chunks: one model reply ends with a `stop` finish. */
function textResponse(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, char => ({ type: 'text-delta', index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** Scripted chunks for one tool call (mirrors the agent-loop mock-adapter helper). */
function toolCallResponse(rawCallId, name, args, text) {
  const callId = ToolCallId(rawCallId)
  const argumentsJson = JSON.stringify(args)
  const chunks = []
  let index = 0
  if (text) {
    chunks.push(
      { type: 'block-start', index, blockType: 'text' },
      { type: 'text-delta', index, text },
      { type: 'block-end', index, block: { type: 'text', text } },
    )
    index += 1
  }
  chunks.push(
    { type: 'block-start', index, blockType: 'tool-call' },
    { type: 'tool-call-delta', index, id: callId, name, argumentsDelta: argumentsJson.slice(0, 5) },
    { type: 'tool-call-delta', index, id: callId, argumentsDelta: argumentsJson.slice(5) },
    { type: 'block-end', index, block: { type: 'tool-call', id: callId, name, arguments: argumentsJson } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  )
  return chunks
}

/** Minimal scripted adapter: each model call consumes the next entry. */
class MockAdapter extends LlmAdapter {
  constructor(script) {
    super()
    this.script = script
    this.requests = []
  }

  async resolveModel(provider, model) {
    return { provider, id: model, name: model }
  }

  async * stream(options) {
    this.requests.push(options)
    const chunks = this.script.shift()
    if (!chunks) throw new Error('MockAdapter: script exhausted')
    for (const chunk of chunks) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}

async function harness({ subagents = true, maxConsecutiveBlocks = 3 } = {}) {
  const ctx = new Context()
  // Session persistence dirs would otherwise land in the process CWD; give the
  // harness a real temp root and a disposer the tests' `ctx.dispose?.()` calls
  // (no-ops on a bare root Context) actually run.
  const persistenceRoot = mkdtempSync(join(tmpdir(), 'gates-persist-'))
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  // The agent loop and its turnBoundary projection declare sessionProjections
  // a required injection: mount the projection registry plus a persistence
  // backend before the loop activates (same order as the acp test harness).
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(JsonlSessionPersistence, { root: persistenceRoot, compression: 'none' })
  await ctx.plugin(TokenMeter)
  await ctx.plugin(AgentLoop, { agents: [] })
  if (subagents) {
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(fork, { providerName: 'fork' })
  }
  await ctx.plugin(gates, { maxConsecutiveBlocks })
  ctx.dispose = async () => {
    rmSync(persistenceRoot, { recursive: true, force: true })
  }
  return ctx
}

function waitForIdle(ctx, agent) {
  return new Promise(resolve => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

/** Poll until a predicate holds; the fixer child runs off-turn, outside the parent's idle window. */
async function waitFor(predicate, timeoutMs = 3000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

test('a failing defer gate does not steer the turn and keeps the window dirty', async () => {
  // Two model calls: one per turn. The gate fails both times (no fixer), so
  // the dirt window stays open and the gate re-runs on the second turn.
  const adapter = new MockAdapter([textResponse('t1'), textResponse('t2')])
  const ctx = await harness()
  ctx.llm.registerAdapter(['mock'], adapter)

  let checks = 0
  ctx.get('gates').register({
    id: 'defer-demo',
    description: 'defer gate',
    rationale: 'why it exists',
    on: ['stop', 'manual'],
    level: 'defer',
    check: async () => {
      checks += 1
      return [{
        file: 'a.md',
        line: 1,
        reason: 'missing description',
        remedy: { kind: 'manual', guidance: 'add it' },
      }]
    },
  })

  const root = mkdtempSync(join(tmpdir(), 'gates-defer-'))
  const agent = ctx.agentLoop.create(
    SessionId('defer-run'),
    { provider: 'mock', model: 'mock' },
    { cwd: root },
  )
  try {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    // No steer: the turn closed after exactly one model call.
    assert.equal(adapter.requests.length, 1, 'turn must close without a forced continuation')
    assert.equal(checks, 1, 'gate must have run once')

    // The dirty window persists: a second turn re-runs the gate.
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'again' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    assert.equal(checks, 2, 'gate must re-run on the next turn because the window stayed dirty')
  } finally {
    await ctx.dispose?.()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a failing blocking gate still steers the turn (budget cycle)', async () => {
  // Budget 3: initial step + 3 forced continuations, then degrade to pass.
  const adapter = new MockAdapter([textResponse('s1'), textResponse('s2'), textResponse('s3'), textResponse('s4')])
  const ctx = await harness()
  ctx.llm.registerAdapter(['mock'], adapter)

  ctx.get('gates').register({
    id: 'block-demo',
    description: 'blocking gate',
    rationale: 'why it exists',
    on: ['stop', 'manual'],
    level: 'blocking',
    check: async () => [{ reason: 'must fix', remedy: { kind: 'manual', guidance: 'fix it' } }],
  })

  const root = mkdtempSync(join(tmpdir(), 'gates-block-'))
  const agent = ctx.agentLoop.create(
    SessionId('block-run'),
    { provider: 'mock', model: 'mock' },
    { cwd: root },
  )
  try {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    assert.equal(adapter.requests.length, 4, 'blocking failure must steer (3 continuations)')
  } finally {
    await ctx.dispose?.()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a blocking gate with its stop dimension off never steers the turn', async () => {
  // The stop-dimension switch removes the gate from the turn-stop selection:
  // the turn closes after exactly one model call, no forced continuation.
  const adapter = new MockAdapter([textResponse('t1')])
  const ctx = await harness()
  ctx.llm.registerAdapter(['mock'], adapter)

  let checks = 0
  ctx.get('gates').register({
    id: 'stop-off-block',
    description: 'blocking gate with stop off',
    rationale: 'why it exists',
    on: ['stop', 'manual'],
    level: 'blocking',
    check: async () => {
      checks += 1
      return [{ reason: 'must fix', remedy: { kind: 'manual', guidance: 'fix it' } }]
    },
  })

  const root = mkdtempSync(join(tmpdir(), 'gates-stop-off-'))
  const agent = ctx.agentLoop.create(
    SessionId('stop-off-run'),
    { provider: 'mock', model: 'mock' },
    { cwd: root },
  )
  try {
    // Turn the stop dimension off before the turn runs (the same remote the
    // settings tab uses), then let the turn close.
    ctx.get('gatesController').setDisabled({ stop: ['stop-off-block'], manual: [], workspace: root })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    assert.equal(adapter.requests.length, 1, 'turn must close without a forced continuation')
    assert.equal(checks, 0, 'the gate must not run at turn-stop when its stop dimension is off')
  } finally {
    await ctx.dispose?.()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a failing defer gate with a subagent fixer dispatches a child off-turn', async () => {
  // Parent turn consumes the first entry; the fixer child consumes the second.
  const adapter = new MockAdapter([textResponse('done'), textResponse('fixed')])
  const ctx = await harness()
  ctx.llm.registerAdapter(['mock'], adapter)

  let checks = 0
  ctx.get('gates').register({
    id: 'defer-fix',
    description: 'defer gate with a fixer',
    rationale: 'why it exists',
    on: ['stop', 'manual'],
    level: 'defer',
    fixer: { kind: 'subagent', prompt: 'Read each file and add a non-empty description.' },
    check: async () => {
      // Fail only the parent's check; the fixer child's own gate run passes, so
      // it dispatches no grandchild (a clean assertion).
      checks += 1
      return checks === 1
        ? [{ file: 'a.md', line: 1, reason: 'missing description', remedy: { kind: 'manual', guidance: 'add it' } }]
        : []
    },
  })

  const root = mkdtempSync(join(tmpdir(), 'gates-defer-fix-'))
  const agent = ctx.agentLoop.create(
    SessionId('defer-fix-run'),
    { provider: 'mock', model: 'mock' },
    { cwd: root },
  )
  try {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    // The fixer child runs off-turn, so wait for its model call to arrive.
    await waitFor(() => adapter.requests.length >= 2)
    assert.equal(adapter.requests.length, 2, 'parent turn plus fixer child model call')
    assert.equal(checks, 2, 'parent check (fail) + fixer child check (pass)')
  } finally {
    await ctx.dispose?.()
    rmSync(root, { recursive: true, force: true })
  }
})

test('ctx.gates.runAndRepair dispatches a fixer without the turn-stopping driver', async () => {
  // No parent turn: the only model call is the fixer child's.
  const adapter = new MockAdapter([textResponse('fixed')])
  const ctx = await harness()
  ctx.llm.registerAdapter(['mock'], adapter)

  let checks = 0
  ctx.get('gates').register({
    id: 'defer-service-fix',
    description: 'defer gate with a fixer',
    rationale: 'why it exists',
    on: ['stop', 'manual'],
    level: 'defer',
    fixer: { kind: 'subagent', prompt: 'Read each file and add a non-empty description.' },
    check: async () => {
      // Fail the service-run check; the fixer child's own gate run passes, so
      // it dispatches no grandchild (a clean assertion).
      checks += 1
      return checks === 1
        ? [{ file: 'a.md', line: 1, reason: 'missing description', remedy: { kind: 'manual', guidance: 'add it' } }]
        : []
    },
  })

  const root = mkdtempSync(join(tmpdir(), 'gates-defer-service-'))
  const agent = ctx.agentLoop.create(
    SessionId('defer-service-run'),
    { provider: 'mock', model: 'mock' },
    { cwd: root },
  )
  try {
    const results = await ctx.get('gates').runAndRepair(root, {
      agent,
      signal: new AbortController().signal,
    })
    assert.equal(results.length, 1)
    assert.equal(results[0].status, 'failed', 'service-run check must fail once')
    // The fixer child runs off-turn; wait for its model call to arrive.
    await waitFor(() => adapter.requests.length >= 1)
    assert.equal(adapter.requests.length, 1, 'only the fixer child runs (no parent turn)')
  } finally {
    await ctx.dispose?.()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a subagent fixer passes its request overlay through to ctx.subagents.start', async () => {
  const adapter = new MockAdapter([textResponse('done'), textResponse('fixed')])
  const ctx = await harness()
  ctx.llm.registerAdapter(['mock'], adapter)

  // Spy on the subagent seam to observe the exact request gates builds.
  const subagents = ctx.get('subagents')
  const originalStart = subagents.start.bind(subagents)
  let captured
  subagents.start = (provider, request) => {
    captured = { provider, request }
    return originalStart(provider, request)
  }

  let checks = 0
  ctx.get('gates').register({
    id: 'defer-passthrough',
    description: 'defer gate with a request overlay',
    rationale: 'why it exists',
    on: ['stop', 'manual'],
    level: 'defer',
    fixer: {
      kind: 'subagent',
      prompt: 'Read each file and add a non-empty description.',
      request: {
        persona: 'FIXER PERSONA',
        toolFilter: { deny: [] },
        agentOptions: { model: 'mock' },
      },
    },
    check: async () => {
      checks += 1
      return checks === 1
        ? [{ file: 'a.md', line: 1, reason: 'missing description', remedy: { kind: 'manual', guidance: 'add it' } }]
        : []
    },
  })

  const root = mkdtempSync(join(tmpdir(), 'gates-defer-passthrough-'))
  const agent = ctx.agentLoop.create(
    SessionId('defer-passthrough-run'),
    { provider: 'mock', model: 'mock' },
    { cwd: root },
  )
  try {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    await waitFor(() => adapter.requests.length >= 2)

    assert.equal(captured.provider, 'fork', 'request provider defaults to fork when absent')
    assert.equal(captured.request.persona, 'FIXER PERSONA', 'persona passes through')
    assert.deepEqual(captured.request.toolFilter, { deny: [] }, 'toolFilter passes through')
    assert.deepEqual(captured.request.agentOptions, { model: 'mock' }, 'agentOptions passes through')
    assert.equal(captured.request.maxDepth, 1, 'gates owns the maxDepth recursion guard')
    assert.equal(captured.request.label, 'gates:fix:defer-passthrough', 'gates owns the label')
    assert.equal(captured.request.parent, agent, 'gates owns the parent')
  } finally {
    await ctx.dispose?.()
    rmSync(root, { recursive: true, force: true })
  }
})

// The command fixer runs a real shell subprocess. In this sandbox, piped-stdio
// spawn is blocked (EPERM) and the fixer degrades gracefully; in a non-sandboxed
// run the command actually executes and exits nonzero — both converge on the
// same assertions (window stays dirty, gate re-runs next turn).
test('a command fixer that fails keeps the window dirty so the gate re-runs', async () => {
  const adapter = new MockAdapter([textResponse('done'), textResponse('done')])
  const ctx = await harness()
  ctx.llm.registerAdapter(['mock'], adapter)

  let checks = 0
  ctx.get('gates').register({
    id: 'defer-cmd-fail',
    description: 'defer gate with a failing command fixer',
    rationale: 'why it exists',
    on: ['stop', 'manual'],
    level: 'defer',
    fixer: { kind: 'command', command: 'node -e "process.exit(3)"' },
    check: async () => {
      checks += 1
      return [{ file: 'a.md', line: 1, reason: 'missing description', remedy: { kind: 'manual', guidance: 'add it' } }]
    },
  })

  const root = mkdtempSync(join(tmpdir(), 'gates-defer-cmd-fail-'))
  const agent = ctx.agentLoop.create(
    SessionId('defer-cmd-fail-run'),
    { provider: 'mock', model: 'mock' },
    { cwd: root },
  )
  try {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    assert.equal(checks, 1, 'gate ran on first turn')

    // The failed fixer keeps the window dirty, so the gate re-runs next turn.
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'again' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    assert.equal(checks, 2, 'the gate must re-run because the failed command fixer kept the window dirty')
  } finally {
    await ctx.dispose?.()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a subagent fixer degrades gracefully when ctx.subagents is absent', async () => {
  const adapter = new MockAdapter([textResponse('done')])
  const ctx = await harness({ subagents: false })
  ctx.llm.registerAdapter(['mock'], adapter)

  let checks = 0
  ctx.get('gates').register({
    id: 'defer-no-subagents',
    description: 'defer gate with a subagent fixer but no subagent capability',
    rationale: 'why it exists',
    on: ['stop', 'manual'],
    level: 'defer',
    fixer: { kind: 'subagent', prompt: 'Read each file and add a non-empty description.' },
    check: async () => {
      checks += 1
      return [{ file: 'a.md', line: 1, reason: 'missing description', remedy: { kind: 'manual', guidance: 'add it' } }]
    },
  })

  const root = mkdtempSync(join(tmpdir(), 'gates-defer-nosub-'))
  const agent = ctx.agentLoop.create(
    SessionId('defer-nosub-run'),
    { provider: 'mock', model: 'mock' },
    { cwd: root },
  )
  try {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    // No subagent capability → no child dispatched.
    assert.equal(adapter.requests.length, 1, 'no child runs without the subagents service')
    assert.equal(checks, 1, 'gate ran once, fixer was not dispatched')
  } finally {
    await ctx.dispose?.()
    rmSync(root, { recursive: true, force: true })
  }
})

test('parallel agents each get steered only on their own broken links (W10 attribution)', async () => {
  // One workspace root with two pre-existing broken links: a full scan sees
  // BOTH, so isolation must come from each agent's per-session change set, not
  // from visibility. The `write` tool only records dirt (files are pre-seeded);
  // the real doc-link check filters the full scan to that agent's own files.
  const root = mkdtempSync(join(tmpdir(), 'gates-doclink-'))
  writeFileSync(join(root, 'task-a.md'), '[broken](task-a-missing.md)\n')
  writeFileSync(join(root, 'task-b.md'), '[broken](task-b-missing.md)\n')
  spawnSync('git', ['init', '-q', root], { stdio: 'ignore' })
  spawnSync('git', ['-C', root, 'add', '-A'], { stdio: 'ignore' })

  // maxConsecutiveBlocks: 1 → each agent steers exactly once, then degrades.
  const adapter = new MockAdapter([
    toolCallResponse('a1', 'write', { file_path: 'task-a.md' }),
    textResponse('a done'),
    textResponse('a steered'),
    toolCallResponse('b1', 'write', { file_path: 'task-b.md' }),
    textResponse('b done'),
    textResponse('b steered'),
  ])
  const ctx = await harness({ subagents: false, maxConsecutiveBlocks: 1 })
  ctx.llm.registerAdapter(['mock'], adapter)
  ctx.tools.register(defineContentToolFixture({
    name: 'write',
    description: 'test write: records session dirt (content pre-seeded on disk)',
    parameters: { file_path: { type: 'string' } },
    async execute() { return [] },
  }))
  ctx.get('gates').register({
    id: 'doc-link',
    description: 'internal markdown references resolve',
    rationale: 'broken links rot documentation silently',
    on: ['stop', 'manual'],
    level: 'blocking',
    check: async (r, changes) => docLinkCheck(r, changes),
  })

  const makeAgent = (sessionId) => {
    const agent = ctx.agentLoop.create(
      SessionId(sessionId),
      { provider: 'mock', model: 'mock' },
      { cwd: root },
    )
    const steers = []
    const originalSteer = agent.steer.bind(agent)
    agent.steer = (message) => { steers.push(message); return originalSteer(message) }
    return { agent, steers }
  }

  try {
    const A = makeAgent('doclink-a')
    A.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, A.agent)

    const B = makeAgent('doclink-b')
    B.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, B.agent)

    const steerText = steers => steers
      .map(message => message.content.map(block => block.text ?? '').join(''))
      .join('\n')

    const aText = steerText(A.steers)
    const bText = steerText(B.steers)

    assert.equal(A.steers.length, 1, 'agent A steers exactly once')
    assert.equal(B.steers.length, 1, 'agent B steers exactly once')
    assert.ok(aText.includes('task-a.md'), 'A is steered on its own broken link')
    assert.ok(!aText.includes('task-b.md'), 'A must not be steered on B\'s broken link')
    assert.ok(bText.includes('task-b.md'), 'B is steered on its own broken link')
    assert.ok(!bText.includes('task-a.md'), 'B must not be steered on A\'s broken link')
  } finally {
    await ctx.dispose?.()
    rmSync(root, { recursive: true, force: true })
  }
})

test('an opaque tool call steers every broken link (W10 opaque → true clause)', async () => {
  // A non-whitelisted tool (`bash`) carries no precise `file_path`, so the dirt
  // goes opaque. The attribution filter's fail-closed `opaque → true` then keeps
  // EVERY violation the full scan finds — both broken links are steered, not
  // just the one a precise write would claim.
  const root = mkdtempSync(join(tmpdir(), 'gates-doclink-opaque-'))
  writeFileSync(join(root, 'task-a.md'), '[broken](task-a-missing.md)\n')
  writeFileSync(join(root, 'task-b.md'), '[broken](task-b-missing.md)\n')
  spawnSync('git', ['init', '-q', root], { stdio: 'ignore' })
  spawnSync('git', ['-C', root, 'add', '-A'], { stdio: 'ignore' })

  const adapter = new MockAdapter([
    toolCallResponse('o1', 'bash', { command: 'echo hi' }),
    textResponse('done'),
    textResponse('steered'),
  ])
  const ctx = await harness({ subagents: false, maxConsecutiveBlocks: 1 })
  ctx.llm.registerAdapter(['mock'], adapter)
  ctx.tools.register(defineContentToolFixture({
    name: 'bash',
    description: 'test bash: an opaque write channel with no precise file_path',
    parameters: { command: { type: 'string' } },
    async execute() { return [] },
  }))
  ctx.get('gates').register({
    id: 'doc-link',
    description: 'internal markdown references resolve',
    rationale: 'broken links rot documentation silently',
    on: ['stop', 'manual'],
    level: 'blocking',
    check: async (r, changes) => docLinkCheck(r, changes),
  })

  const agent = ctx.agentLoop.create(
    SessionId('doclink-opaque'),
    { provider: 'mock', model: 'mock' },
    { cwd: root },
  )
  const steers = []
  const originalSteer = agent.steer.bind(agent)
  agent.steer = (message) => { steers.push(message); return originalSteer(message) }

  try {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const text = steers
      .map(message => message.content.map(block => block.text ?? '').join(''))
      .join('\n')

    assert.equal(steers.length, 1, 'opaque change steers exactly once under budget 1')
    assert.ok(text.includes('task-a.md'), 'opaque steers the task-a broken link')
    assert.ok(text.includes('task-b.md'), 'opaque steers the task-b broken link too (fail-closed all)')
  } finally {
    await ctx.dispose?.()
    rmSync(root, { recursive: true, force: true })
  }
})

test('writing a link target steers the inbound broken #fragment (W10 target ∈ W clause)', async () => {
  // `a.md` links `b.md#old`, but `b.md` only carries `# New` — the anchor is
  // broken. The session writes `b.md` (the TARGET), never `a.md` (the source).
  // The full scan reports the violation at `a.md`; attribution keeps it because
  // the written target ∈ W, so the steer points at `a.md` even though `a.md`
  // was never written — the inbound anchor break is attributed through its target.
  const root = mkdtempSync(join(tmpdir(), 'gates-doclink-target-'))
  writeFileSync(join(root, 'a.md'), '[x](b.md#old)\n')
  writeFileSync(join(root, 'b.md'), '# New\n')
  spawnSync('git', ['init', '-q', root], { stdio: 'ignore' })
  spawnSync('git', ['-C', root, 'add', '-A'], { stdio: 'ignore' })

  const adapter = new MockAdapter([
    toolCallResponse('t1', 'write', { file_path: 'b.md' }),
    textResponse('done'),
    textResponse('steered'),
  ])
  const ctx = await harness({ subagents: false, maxConsecutiveBlocks: 1 })
  ctx.llm.registerAdapter(['mock'], adapter)
  ctx.tools.register(defineContentToolFixture({
    name: 'write',
    description: 'test write: records session dirt (content pre-seeded on disk)',
    parameters: { file_path: { type: 'string' } },
    async execute() { return [] },
  }))
  ctx.get('gates').register({
    id: 'doc-link',
    description: 'internal markdown references resolve',
    rationale: 'broken links rot documentation silently',
    on: ['stop', 'manual'],
    level: 'blocking',
    check: async (r, changes) => docLinkCheck(r, changes),
  })

  const agent = ctx.agentLoop.create(
    SessionId('doclink-target'),
    { provider: 'mock', model: 'mock' },
    { cwd: root },
  )
  const steers = []
  const originalSteer = agent.steer.bind(agent)
  agent.steer = (message) => { steers.push(message); return originalSteer(message) }

  try {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const text = steers
      .map(message => message.content.map(block => block.text ?? '').join(''))
      .join('\n')

    assert.equal(steers.length, 1, 'target write steers exactly once under budget 1')
    assert.ok(text.includes('a.md'), 'steer points at the source with the broken #fragment (a.md)')
    assert.ok(text.includes('anchor does not exist'), 'the violation is the missing #old anchor')
  } finally {
    await ctx.dispose?.()
    rmSync(root, { recursive: true, force: true })
  }
})
