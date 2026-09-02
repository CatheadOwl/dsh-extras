import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the `ctx.promptMiddleware` Context augmentation from service.
import type {} from './service.js'

import type { DeclarativeRelatesProvider, PromptMiddlewareProvider } from './types.js'

export type {
  PromptPathKind,
  ResolvedPromptPath,
  RelatesItem,
  PromptRelatesContribution,
  PromptMiddlewareInput,
  PromptMiddlewareProviderMode,
  PromptMiddlewareProvider,
  PromptMiddlewareProviderEntry,
  RelatesResolveContext,
  RelatesResolveResult,
  DeclarativeRelatesProvider,
  PromptMiddlewareTraceStatus,
  PromptMiddlewareTraceEvent,
  PromptMiddlewareConfig,
  PromptMiddlewareRunOptions,
  PromptRelatesGroup,
  PromptMiddlewareRunResult,
  PromptMiddlewareProviderView,
} from './types.js'

export function registerPromptMiddlewareProvider(ctx: Context, provider: PromptMiddlewareProvider): void {
  ctx.inject(['promptMiddleware'], (promptCtx) => {
    return promptCtx.promptMiddleware.register(provider)
  })
}

/**
 * Hard-import registration face for declarative relates providers. Consumers
 * `import { registerRelatesProvider } from '@catheadowl/dsh-extras/prompt/register'`
 * and call it in `apply(ctx)` instead of hand-writing structural `*Like` mirrors
 * plus `ctx.inject(['promptMiddleware'], …)`. The provider is materialized by
 * the same runner as the seam face (once ledger / aggregation / budget /
 * timeout / rendering) and shares its lifecycle: the disposer returned by
 * `registerRelates` runs when the owning fiber unloads or the prompt service
 * disappears — the same lifecycle as the seam face.
 */
export function registerRelatesProvider(ctx: Context, provider: DeclarativeRelatesProvider): void {
  ctx.inject(['promptMiddleware'], (promptCtx) => {
    return promptCtx.promptMiddleware.registerRelates(provider)
  })
}
