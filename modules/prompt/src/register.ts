import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the `ctx.promptMiddleware` Context augmentation from service.
import type {} from './service.js'

import type { PromptMiddlewareProvider } from './types.js'

export type * from './types.js'

export function registerPromptMiddlewareProvider(ctx: Context, provider: PromptMiddlewareProvider): void {
  ctx.inject(['promptMiddleware'], (promptCtx) => {
    return promptCtx.promptMiddleware.register(provider)
  })
}
