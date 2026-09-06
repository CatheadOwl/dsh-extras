// Real composition tests for the touch sensor lane: a real agent loop where
// the scripted model actually CALLS read/edit tools, driving the framework's
// tools/result sensor → pending → pre-step consumption pipeline end to end.
//
// Like composition.test.mjs, this file imports the dsh host's packages
// through the plugin's local junctions and boots a Cordis process.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import TokenMeter from '@deepseek-ai/dsh-token-meter'

import * as promptMiddleware from '../lib/index.js'

function textResponse(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, char => ({ type: 'text-delta', index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** Scripted tool-call step, mirroring the host loop specs' chunk format. */
function toolCallResponse(rawCallId, name, args) {
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: ToolCallId(rawCallId), name, argumentsDelta: argumentsJson },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(rawCallId), name, arguments: argumentsJson } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

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

async function harness(persistenceRoot) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(JsonlSessionPersistence, { root: persistenceRoot, compression: 'none' })
  await ctx.plugin(TokenMeter)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(promptMiddleware, {})
  // Minimal stand-ins for the host's read/edit tools: the sensor only reads
  // the tool name and arguments.file_path.
  ctx.tools.register(defineContentToolFixture({
    name: 'read',
    description: 'read a file',
    parameters: { file_path: { type: 'string' } },
    async execute() { return [{ type: 'text', text: 'file content' }] },
  }))
  ctx.tools.register(defineContentToolFixture({
    name: 'edit',
    description: 'edit a file',
    parameters: { file_path: { type: 'string' } },
    async execute() { return [{ type: 'text', text: 'edited' }] },
  }))
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

function injectionsOf(agent) {
  return agent.session.events.filter(event =>
    event.type === 'user/message'
    && event.data.source?.kind === 'plugin'
    && event.data.source?.plugin === 'prompt-middleware'
    && event.data.content?.some(block => block.type === 'text' && block.text.includes('relates:')))
}

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'pm-touch-'))
  mkdirSync(join(root, 'docs'), { recursive: true })
  writeFileSync(join(root, 'docs', 'guide.md'), '# Guide\n', 'utf8')
  return root
}

test('v0 equivalence: a default provider is untouched by sensor traffic in the same turn', async () => {
  const adapter = new MockAdapter([toolCallResponse('c1', 'read', { file_path: 'PLACEHOLDER' }), textResponse('done')])
  const persistenceRoot = mkdtempSync(join(tmpdir(), 'pm-touch-persist-'))
  const ctx = await harness(persistenceRoot)
  ctx.llm.registerAdapter(['mock'], adapter)
  const root = fixtureRoot()
  adapter.script[0] = toolCallResponse('c1', 'read', { file_path: join(root, 'docs', 'guide.md') })

  ctx.get('promptMiddleware').registerRelates({
    name: 'plain-notes',
    kind: 'plain-note',
    async resolve({ path }) {
      return { value: `note for ${path.path}` }
    },
  })

  const agent = ctx.agentLoop.create(SessionId('v0-run'), { provider: 'mock', model: 'mock' }, { cwd: root })
  try {
    const ask = () => createUserMessage({
      content: [{ type: 'text', text: 'look at docs/guide.md please' }],
      source: { kind: 'user' },
    })
    const turn1 = waitForIdle(ctx, agent)
    agent.followup(ask())
    await turn1
    // Turn 1: mention injects once; the mid-turn read (sensor records,
    // nothing consumes it — the provider never subscribed) adds nothing.
    const injections = injectionsOf(agent)
    assert.equal(injections.length, 1, 'exactly the prompt-mention injection')
    assert.ok(injections[0].data.content[0].text.includes('docs/guide.md:'))
    assert.equal(adapter.requests.length, 2, 'tool-call step + final text step')

    const turn2 = waitForIdle(ctx, agent)
    agent.followup(ask())
    await turn2
    assert.equal(injectionsOf(agent).length, 1, 'second mention still once-suppressed')
  } finally {
    rmSync(persistenceRoot, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('touch consumption: a later read re-offers the subject, steady-state resolve stays silent (chatter)', async () => {
  const adapter = new MockAdapter([])
  const persistenceRoot = mkdtempSync(join(tmpdir(), 'pm-touch2-persist-'))
  const ctx = await harness(persistenceRoot)
  ctx.llm.registerAdapter(['mock'], adapter)
  const root = fixtureRoot()
  const guideAbs = join(root, 'docs', 'guide.md')

  const seen = []
  const rendered = new Set()
  ctx.get('promptMiddleware').registerRelates({
    name: 'pair-notes',
    kind: 'pair-note',
    sources: ['prompt', 'touch'],
    touchSubjects: touched => (touched.startsWith('docs/') ? [touched] : []),
    async resolve({ path }) {
      seen.push(`${path.origin}:${path.path}:${path.touchTool ?? '-'}`)
      // Steady state: this subject already rendered this session, and nothing
      // about it changed — the provider pattern that keeps touches silent.
      if (rendered.has(path.path)) return undefined
      rendered.add(path.path)
      return { value: `note for ${path.path}` }
    },
  })

  const agent = ctx.agentLoop.create(SessionId('touch-run'), { provider: 'mock', model: 'mock' }, { cwd: root })
  try {
    // Two reads of the same file, then a closing text step: the second read's
    // re-offer only reaches resolve again if the first undefined pass left the
    // key UNLEDGERED (ADR 0004 §5: no render → no re-mark → key stays bare).
    adapter.script.push(
      toolCallResponse('c1', 'read', { file_path: guideAbs }),
      toolCallResponse('c2', 'read', { file_path: guideAbs }),
      textResponse('done'),
    )
    const turn1 = waitForIdle(ctx, agent)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'review docs/guide.md for me' }],
      source: { kind: 'user' },
    }))
    await turn1

    const injections = injectionsOf(agent)
    assert.equal(injections.length, 1, 'prompt mention injected once; both touch re-offers stayed silent')
    assert.equal(seen.length, 3, 'resolve ran three times: mention + two touch re-offers (the key never re-ledgered)')
    assert.ok(seen[0].startsWith('prompt-parse:docs/guide.md:-'), 'the first resolve came from the prompt mention')
    assert.ok(seen[1].startsWith('touch:docs/guide.md:read'), 'the first re-offer carried touch provenance')
    assert.ok(seen[2].startsWith('touch:docs/guide.md:read'), 'the second re-offer reached resolve too — chatter stays resolved by the provider, not the ledger')
    assert.equal(adapter.requests.length, 3, 'tool-call step ×2 + final text step')
  } finally {
    rmSync(persistenceRoot, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('state flip: an edit re-offers the subject and a changed value re-injects', async () => {
  const adapter = new MockAdapter([])
  const persistenceRoot = mkdtempSync(join(tmpdir(), 'pm-touch3-persist-'))
  const ctx = await harness(persistenceRoot)
  ctx.llm.registerAdapter(['mock'], adapter)
  const root = fixtureRoot()
  const guideAbs = join(root, 'docs', 'guide.md')

  let version = 0
  ctx.get('promptMiddleware').registerRelates({
    name: 'flip-notes',
    kind: 'flip-note',
    sources: ['prompt', 'touch'],
    touchSubjects: touched => (touched.startsWith('docs/') ? [touched] : []),
    async resolve({ path }) {
      version += 1
      return { value: `v${version} for ${path.path}` }
    },
  })

  const agent = ctx.agentLoop.create(SessionId('flip-run'), { provider: 'mock', model: 'mock' }, { cwd: root })
  try {
    adapter.script.push(toolCallResponse('c1', 'edit', { file_path: guideAbs }), textResponse('done'))
    const turn1 = waitForIdle(ctx, agent)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'check docs/guide.md' }],
      source: { kind: 'user' },
    }))
    await turn1

    const injections = injectionsOf(agent)
    assert.equal(injections.length, 2, 'mention injection + post-edit re-injection')
    assert.ok(injections[0].data.content[0].text.includes('v1 for docs/guide.md'))
    assert.ok(injections[1].data.content[0].text.includes('v2 for docs/guide.md'), 'the re-run saw the flipped value')
  } finally {
    rmSync(persistenceRoot, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('unpaired touch: zero resolves, zero injections', async () => {
  const adapter = new MockAdapter([])
  const persistenceRoot = mkdtempSync(join(tmpdir(), 'pm-touch4-persist-'))
  const ctx = await harness(persistenceRoot)
  ctx.llm.registerAdapter(['mock'], adapter)
  const root = fixtureRoot()
  const outside = join(root, 'unpaired', 'other.md')

  let calls = 0
  ctx.get('promptMiddleware').registerRelates({
    name: 'pair-notes',
    kind: 'pair-note',
    sources: ['touch'],
    touchSubjects: touched => (touched.startsWith('docs/') ? [touched] : []),
    async resolve() {
      calls += 1
      return { value: 'x' }
    },
  })

  const agent = ctx.agentLoop.create(SessionId('unpaired-run'), { provider: 'mock', model: 'mock' }, { cwd: root })
  try {
    adapter.script.push(toolCallResponse('c1', 'read', { file_path: outside }), textResponse('done'))
    const turn1 = waitForIdle(ctx, agent)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'read the unpaired file' }],
      source: { kind: 'user' },
    }))
    await turn1
    assert.equal(calls, 0, 'unpaired touch never reaches resolve')
    assert.equal(injectionsOf(agent).length, 0)
  } finally {
    rmSync(persistenceRoot, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('toggle × touch: switched-off provider neither injects nor ledgers; re-enable injects', async () => {
  const adapter = new MockAdapter([])
  const persistenceRoot = mkdtempSync(join(tmpdir(), 'pm-touch5-persist-'))
  const ctx = await harness(persistenceRoot)
  ctx.llm.registerAdapter(['mock'], adapter)
  const root = fixtureRoot()
  const guideAbs = join(root, 'docs', 'guide.md')

  let calls = 0
  ctx.get('promptMiddleware').registerRelates({
    name: 'switchable-notes',
    kind: 'switch-note',
    sources: ['prompt', 'touch'],
    touchSubjects: touched => (touched.startsWith('docs/') ? [touched] : []),
    async resolve({ path }) {
      calls += 1
      return { value: `note for ${path.path}` }
    },
  })

  const agent = ctx.agentLoop.create(SessionId('toggle-run'), { provider: 'mock', model: 'mock' }, { cwd: root })
  const service = ctx.get('promptMiddleware')
  try {
    const ask = () => createUserMessage({
      content: [{ type: 'text', text: 'check docs/guide.md' }],
      source: { kind: 'user' },
    })

    // Turn 1 (provider ON): the mention injects and writes the ledger.
    adapter.script.push(textResponse('done'))
    let turn = waitForIdle(ctx, agent)
    agent.followup(ask())
    await turn
    assert.equal(calls, 1)
    assert.equal(injectionsOf(agent).length, 1)

    // Turn 2 (provider OFF): an edit touch consumes nothing, but its
    // invalidation still removes the ledger key — the switch must not gain
    // ledger-write powers by masking invalidation (spec §7).
    service.setDisabled(['switchable-notes'])
    adapter.script.push(toolCallResponse('c1', 'edit', { file_path: guideAbs }), textResponse('done'))
    turn = waitForIdle(ctx, agent)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'tweak it' }],
      source: { kind: 'user' },
    }))
    await turn
    assert.equal(calls, 1, 'switched-off provider never runs')
    assert.equal(injectionsOf(agent).length, 1)

    // Turn 3 (provider ON again): the off-period touch removed the key, so
    // the same mention re-injects — the discriminator for "invalidation is
    // not filtered by the switch".
    service.setDisabled([])
    adapter.script.push(textResponse('done'))
    turn = waitForIdle(ctx, agent)
    agent.followup(ask())
    await turn
    assert.equal(calls, 2)
    assert.equal(injectionsOf(agent).length, 2, 'the off-period touch invalidated the key; re-enable re-injects')
  } finally {
    rmSync(persistenceRoot, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})
