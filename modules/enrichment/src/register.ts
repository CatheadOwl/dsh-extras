import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the `ctx.enrichment` Context augmentation from service.
import type {} from './service.js'

import type { DeclarativeRelatesProvider, EnrichmentProvider } from './types.js'

export type {
  PromptPathKind,
  ResolvedPromptPath,
  RelatesItem,
  RelatesContribution,
  EnrichmentInput,
  EnrichmentProviderMode,
  EnrichmentProvider,
  EnrichmentProviderEntry,
  RelatesResolveContext,
  RelatesResolveResult,
  DeclarativeRelatesProvider,
  TouchSubjectContext,
  EnrichmentTraceStatus,
  EnrichmentTraceEvent,
  EnrichmentConfig,
  EnrichmentRunOptions,
  RelatesGroup,
  EnrichmentRunResult,
  EnrichmentProviderView,
  EnrichmentIntrospection,
} from './types.js'

export function registerEnrichmentProvider(ctx: Context, provider: EnrichmentProvider): void {
  ctx.inject(['enrichment'], (promptCtx) => {
    return promptCtx.enrichment.register(provider)
  })
}

/**
 * Hard-import registration face for declarative relates providers. Consumers
 * `import { registerRelatesProvider } from '@catheadowl/dsh-extras/enrichment/register'`
 * and call it in `apply(ctx)` instead of hand-writing structural `*Like` mirrors
 * plus `ctx.inject(['enrichment'], …)`. The provider is materialized by
 * the same runner as the seam face (once ledger / aggregation / budget /
 * timeout / rendering) and shares its lifecycle: the disposer returned by
 * `registerRelates` runs when the owning fiber unloads or the prompt service
 * disappears — the same lifecycle as the seam face.
 */
export function registerRelatesProvider(ctx: Context, provider: DeclarativeRelatesProvider): void {
  ctx.inject(['enrichment'], (promptCtx) => {
    return promptCtx.enrichment.registerRelates(provider)
  })
}
