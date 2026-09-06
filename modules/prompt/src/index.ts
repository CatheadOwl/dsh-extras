import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, MessageSource } from '@deepseek-ai/dsh-llm'
import { isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session'

import { PromptMiddlewareController } from './controller.js'
import { resolvePromptPathList } from './path-resolver.js'
import { TouchFloatQueue } from './sensor.js'
import type { TouchExecution } from './sensor.js'
import { ConfigSchema, PromptMiddlewareService } from './service.js'
import type { Config as PromptMiddlewarePluginConfig } from './service.js'
import type { PromptMiddlewareTraceEvent } from './types.js'

// Loads the `tools/result` event declaration onto Context (declaration
// merging from the tools package); no runtime import.
import type {} from '@deepseek-ai/dsh-tools'

// Loader-contract entry only: every composition row's index.ts exports
// exactly name/inject/Config/apply. In-package consumers (tests, client
// half) import the owning modules directly.

export const name = 'prompt-middleware'
export const inject: string[] = []
export const Config = ConfigSchema

const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'prompt-middleware' }

export async function apply(ctx: Context, config: PromptMiddlewarePluginConfig = {}): Promise<void> {
  await ctx.plugin(PromptMiddlewareService, config)
  const service = promptMiddlewareService(ctx)

  // Settings → Plugins → Prompt Middleware surface: the Typert remote for the
  // flat provider list + switches. The browser owns the switch list
  // (localStorage) and the tab mirrors it into host memory through
  // `promptMiddleware/setDisabled` on load and on every switch.
  await ctx.plugin(PromptMiddlewareController, service)

  ctx.on('agent/pre-step', async ({ agent, messages, turn, step, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    // Signal sources compose this step's subject batch; the user prompt text
    // is the only source today. The gate below is "no subjects collected",
    // never "no prompt text": injection targets the current step's admitted
    // request batch at any step boundary, so a source that produces subjects
    // without prompt text (the tool-touch sensor lane) enters here unchanged.
    const prompt = promptText(messages)
    const trace: PromptMiddlewareTraceEvent[] = []
    const cwd = agent.session.header.cwd ?? process.cwd()
    const paths = prompt.trim() === '' ? [] : await resolvePromptPathList(prompt, cwd, { trace })
    if (paths.length === 0 && trace.length === 0) return decision
    const result = await service.run({
      prompt,
      paths,
      agent,
      session: agent.session,
      sessionId: agent.session.id,
      cwd,
      turnId: String(turn),
      stepId: String(step),
      signal,
    })
    for (const event of [...trace, ...result.trace]) {
      traceEvent(ctx, event)
    }
    if (result.text === undefined) return decision
    return {
      kind: 'enter',
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text: result.text }],
          source: PLUGIN_SOURCE,
        }),
      ],
    }
  }, { prepend: true })

  // Tool-touch sensor lane: one framework-owned listener records read/edit
  // file touches into a per-session pending set. Providers never mount their
  // own `tools/result` injection — that would bypass the once ledger, budget,
  // and render discipline this framework exists to share.
  const touchFloats = new TouchFloatQueue()
  ctx.effect(() => () => {
    touchFloats.dispose()
  }, 'prompt-middleware.touchFloats')
  ctx.on('tools/result', (exec: TouchExecution, result: { isError: boolean }) => {
    const touches = touchFloats.settle(exec, result.isError, exec.agent?.session.header.cwd ?? process.cwd())
    if (exec.agent === undefined) return
    const sessionId = exec.agent.session.id
    for (const touch of touches) service.recordTouch(sessionId, touch)
  })

  ctx.on('session/event', (session, event) => {
    if (isReplacementSurfaceEvent(event)) {
      service.clearSession(session.id)
    }
    if (event.type === 'turn/end') {
      service.discardPendingTouches(session.id)
    }
  })
}

function promptMiddlewareService(ctx: Context): PromptMiddlewareService {
  return ctx.get('promptMiddleware') as PromptMiddlewareService
}

function promptText(messages: readonly { source: { kind: string }; content: readonly ContentBlock[] }[]): string {
  const blocks: string[] = []
  for (const message of messages) {
    if (message.source.kind !== 'user') continue
    for (const block of message.content) {
      if (block.type === 'text') blocks.push(block.text)
    }
  }
  return blocks.join('\n')
}

function traceEvent(ctx: Context, event: { provider: string; status: string; reason?: string }): void {
  if (event.status === 'ok') return
  const reason = event.reason === undefined ? '' : `: ${event.reason}`
  ctx.logger.debug(`prompt-middleware: ${event.provider} ${event.status}${reason}`)
}
