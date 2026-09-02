import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, MessageSource } from '@deepseek-ai/dsh-llm'
import { isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session'

import { PromptMiddlewareController } from './controller.js'
import { resolvePromptPathList } from './path-resolver.js'
import { ConfigSchema, PromptMiddlewareService } from './service.js'
import type { Config as PromptMiddlewarePluginConfig } from './service.js'
import type { PromptMiddlewareTraceEvent } from './types.js'

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
    const prompt = promptText(messages)
    if (prompt.trim() === '') return decision
    const trace: PromptMiddlewareTraceEvent[] = []
    const cwd = agent.session.header.cwd ?? process.cwd()
    const paths = await resolvePromptPathList(prompt, cwd, { trace })
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

  ctx.on('session/event', (session, event) => {
    if (isReplacementSurfaceEvent(event)) {
      service.clearSession(session.id)
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
