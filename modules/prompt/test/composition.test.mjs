// Real composition test: boots prompt-middleware + any_routes over a real
// agent loop and asserts the `once`-mode breadcrumb injection across multiple
// turns of ONE session — turn 1 injects, turn 2 (same path) is suppressed,
// a surface replacement (compact) clears the ledger, turn 3 re-injects.
//
// Unlike the rest of the suite, this test DOES import the dsh host's
// `@deepseek-ai/*` packages (through the plugin's local junctions) and a
// Cordis process, because the driver under test only runs at `agent/pre-step`
// and the clear hook only runs on `session/event` surface replacement.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import TokenMeter from '@deepseek-ai/dsh-token-meter'

import * as promptMiddleware from '../lib/index.js'
import * as anyRoutes from '../../routes/lib/index.js'

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

async function harness(persistenceRoot) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  // The agent loop and its turnBoundary projection declare sessionProjections
  // a required injection: mount the projection registry plus a persistence
  // backend before the loop activates (same order as the acp test harness).
  // The persistence root is a per-test temp dir so session.jsonl files never
  // land inside the plugin checkout.
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(JsonlSessionPersistence, { root: persistenceRoot, compression: 'none' })
  await ctx.plugin(TokenMeter)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(promptMiddleware, {})
  await ctx.plugin(anyRoutes, {})
  return ctx
}

/**
 * Resolve once the agent reports `idle` after the current turn. Register the
 * listener BEFORE `followup` so the idle transition cannot slip past it.
 */
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

/** Poll until a predicate holds (any_routes registers its provider off-turn via ctx.inject). */
async function waitFor(predicate, timeoutMs = 3000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

test('once-mode breadcrumb injects once, dedupes across turns, and re-arms after compact', async () => {
  const adapter = new MockAdapter([textResponse('done'), textResponse('done'), textResponse('done')])
  const persistenceRoot = mkdtempSync(join(tmpdir(), 'pm-once-persist-'))
  const ctx = await harness(persistenceRoot)
  ctx.llm.registerAdapter(['mock'], adapter)

  const root = mkdtempSync(join(tmpdir(), 'pm-once-'))
  mkdirSync(join(root, 'docs'), { recursive: true })
  writeFileSync(join(root, 'docs', 'README.md'), '---\ndescription: Docs route\n---\n# Docs\n', 'utf8')
  writeFileSync(join(root, 'docs', 'guide.md'), '---\ndescription: Guide file\n---\n# Guide\n', 'utf8')

  const agent = ctx.agentLoop.create(
    SessionId('once-run'),
    { provider: 'mock', model: 'mock' },
    { cwd: root },
  )
  try {
    // any_routes registers its breadcrumb provider through
    // ctx.inject(['promptMiddleware']), which settles off-turn.
    await waitFor(() => ctx.get('promptMiddleware').list().length >= 1)

    const ask = () => createUserMessage({
      content: [{ type: 'text', text: 'read docs/guide.md and tell me what it is about' }],
      source: { kind: 'user' },
    })
    const injections = () => agent.session.events.filter(event =>
      event.type === 'user/message'
      && event.data.source?.kind === 'plugin'
      && event.data.source?.plugin === 'prompt-middleware'
      && event.data.content?.some(block => block.type === 'text' && block.text.includes('relates:')))

    // Turn 1: the breadcrumb subject injects exactly once, keyed by `docs`.
    const turn1 = waitForIdle(ctx, agent)
    agent.followup(ask())
    await turn1
    assert.equal(injections().length, 1, 'turn 1 must inject the breadcrumb once')
    const turn1Text = injections()[0].data.content[0].text
    assert.ok(turn1Text.includes('breadcrumb-description'), 'turn 1 injection carries the breadcrumb')
    assert.ok(turn1Text.includes('docs:'), 'turn 1 group is keyed by the file\'s directory')
    assert.ok(turn1Text.includes('- [breadcrumb-description] Docs route'), 'turn 1 value is the ancestor chain')
    assert.ok(!turn1Text.includes('docs/guide.md:'), 'no file-keyed breadcrumb group')

    // Turn 2: same path in the same session is suppressed by `once`.
    const turn2 = waitForIdle(ctx, agent)
    agent.followup(ask())
    await turn2
    assert.equal(injections().length, 1, 'turn 2 must NOT re-inject the same path')

    // Compact: surface-replace the injected event, mirroring a compaction
    // summary shadowing the surface range the breadcrumb once occupied. The
    // session surface contract demands the replacement cite the shadowed node
    // (start/end = its seq) AND list every shadowed seq in `sourceEventSeqs`,
    // so both reference `injected.seq`.
    const injected = injections()[0]
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'compacted summary' }],
      source: { kind: 'plugin', plugin: 'test-compaction' },
    }), {
      surfaceOp: { op: 'replace', start: injected.seq, end: injected.seq },
      sourceEventSeqs: [injected.seq],
    })

    // Turn 3: the replacement cleared the ledger, so the path re-injects.
    const turn3 = waitForIdle(ctx, agent)
    agent.followup(ask())
    await turn3
    assert.equal(injections().length, 2, 'turn 3 must re-inject after the surface replacement')

    // Sanity: exactly one model call per turn, no extra continuation.
    assert.equal(adapter.requests.length, 3, 'one model call per turn')
  } finally {
    rmSync(persistenceRoot, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('root README never stands in: undescribed ancestors mean no breadcrumb at all (E2E)', async () => {
  const adapter = new MockAdapter([textResponse('done')])
  const persistenceRoot = mkdtempSync(join(tmpdir(), 'pm-root-readme-persist-'))
  const ctx = await harness(persistenceRoot)
  ctx.llm.registerAdapter(['mock'], adapter)

  const root = mkdtempSync(join(tmpdir(), 'pm-root-readme-'))
  // 项目根 readme：脚手架残留描述（真实案例原文），不属于任何子目录。
  writeFileSync(join(root, 'README.md'), '---\ndescription: Open http://localhost:5173 in a desktop browser\n---\n# Root\n', 'utf8')
  // docs/knowledges 目录自身与中间层 docs 均无 README；内部文件带自身描述。
  mkdirSync(join(root, 'docs', 'knowledges'), { recursive: true })
  writeFileSync(join(root, 'docs', 'knowledges', 'guide.md'), '---\ndescription: Knowledge guide\n---\n# Guide\n', 'utf8')

  const agent = ctx.agentLoop.create(
    SessionId('root-readme-run'),
    { provider: 'mock', model: 'mock' },
    { cwd: root },
  )
  try {
    // any_routes registers its breadcrumb provider through
    // ctx.inject(['promptMiddleware']), which settles off-turn.
    await waitFor(() => ctx.get('promptMiddleware').list().length >= 1)

    const ask = () => createUserMessage({
      content: [{ type: 'text', text: 'read docs/knowledges/guide.md and list docs/knowledges/ contents' }],
      source: { kind: 'user' },
    })
    const injections = () => agent.session.events.filter(event =>
      event.type === 'user/message'
      && event.data.source?.kind === 'plugin'
      && event.data.source?.plugin === 'prompt-middleware'
      && event.data.content?.some(block => block.type === 'text' && block.text.includes('relates:')))

    const turn1 = waitForIdle(ctx, agent)
    agent.followup(ask())
    await turn1

    // 文件目标不再回退为文件自身描述；目录目标无自身 README。祖先链全空 +
    // 根 readme 永不顶替 → 完全没有 relates 注入。
    assert.equal(injections().length, 0, 'no breadcrumb at all when no ancestor carries a description')

    // 项目根 readme 的描述绝不进任何目标的面包屑（上一断言已隐含，显式保留锚点）。
    assert.ok(!agent.session.events.some(event =>
      event.type === 'user/message'
      && JSON.stringify(event.data?.content ?? '').includes('Open http://localhost:5173 in a desktop browser')))

    assert.equal(adapter.requests.length, 1, 'one model call for the single turn')
  } finally {
    rmSync(persistenceRoot, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('sibling file mentions share one directory-keyed breadcrumb group (E2E)', async () => {
  const adapter = new MockAdapter([textResponse('done')])
  const persistenceRoot = mkdtempSync(join(tmpdir(), 'pm-sibling-persist-'))
  const ctx = await harness(persistenceRoot)
  ctx.llm.registerAdapter(['mock'], adapter)

  // 复刻真实仓库形状（docs/meeting-room）：meeting-room README 无 frontmatter，
  // 描述来自首个实质正文行；会议文件夹自身与两个 case 文件均无可用描述。
  const root = mkdtempSync(join(tmpdir(), 'pm-sibling-'))
  const meeting = join(root, 'docs', 'meeting-room', '20260822-1436-local-ci-gates')
  mkdirSync(meeting, { recursive: true })
  writeFileSync(join(root, 'docs', 'meeting-room', 'README.md'), [
    '# meeting-room · 会议纪要归档规范',
    '',
    '> 本目录持久化与 agent 的完整设计讨论。',
    '',
    '## 目录命名',
    '',
    '一次会议一个文件夹: `YYYYMMDD-HHMM-{slug}`',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(join(meeting, 'case-1-doc-sync.md'), '# Case 1 · doc-sync\n\n> 定位: 仓库级声明式 gate。\n', 'utf8')
  writeFileSync(join(meeting, 'case-2-coggit-misplaced.md'), '# Case 2 · coggit-misplaced\n\n> 定位: 认知错位。\n', 'utf8')

  const agent = ctx.agentLoop.create(
    SessionId('sibling-run'),
    { provider: 'mock', model: 'mock' },
    { cwd: root },
  )
  try {
    await waitFor(() => ctx.get('promptMiddleware').list().length >= 1)

    const ask = () => createUserMessage({
      content: [{
        type: 'text',
        text: 'review docs/meeting-room/20260822-1436-local-ci-gates/case-1-doc-sync.md and docs/meeting-room/20260822-1436-local-ci-gates/case-2-coggit-misplaced.md',
      }],
      source: { kind: 'user' },
    })
    const injections = () => agent.session.events.filter(event =>
      event.type === 'user/message'
      && event.data.source?.kind === 'plugin'
      && event.data.source?.plugin === 'prompt-middleware'
      && event.data.content?.some(block => block.type === 'text' && block.text.includes('relates:')))

    const turn1 = waitForIdle(ctx, agent)
    agent.followup(ask())
    await turn1

    assert.equal(injections().length, 1, 'one injection')
    const text = injections()[0].data.content[0].text
    // 两个同名兄弟文件 → 唯一目录键分组，祖先链只输出一次。
    assert.ok(text.includes('docs/meeting-room/20260822-1436-local-ci-gates:'), 'group keyed by the shared directory')
    assert.ok(!text.includes('case-1-doc-sync.md:'), 'no file-keyed group for the first sibling')
    assert.ok(!text.includes('case-2-coggit-misplaced.md:'), 'no file-keyed group for the second sibling')
    assert.equal(text.split('[breadcrumb-description]').length - 1, 1, 'exactly one breadcrumb item')
    assert.ok(text.includes('- [breadcrumb-description] 一次会议一个文件夹: YYYYMMDD-HHMM-{slug}'), 'ancestor body-line fallback description')

    assert.equal(adapter.requests.length, 1, 'one model call for the single turn')
  } finally {
    rmSync(persistenceRoot, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})
