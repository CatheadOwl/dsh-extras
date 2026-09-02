/** Public prompt-middleware contracts. */

export type PromptPathKind = 'file' | 'directory'

export interface ResolvedPromptPath {
  /** Project-relative canonical path; directories do not keep a trailing slash. */
  path: string
  kind: PromptPathKind
  origin: 'prompt-parse' | string
  mention?: {
    raw: string
    normalized: string
    kind: 'dir' | 'file' | 'path' | 'bare'
    start: number
    end: number
    total: number
  }
}

export interface RelatesItem {
  kind: string
  label: string
  value?: string
  href?: string
  meta?: Record<string, string>
}

export interface PromptRelatesContribution {
  path: string
  items: RelatesItem[]
}

export interface PromptMiddlewareInput {
  prompt: string
  paths: ResolvedPromptPath[]
  agent: unknown
  session?: unknown
  cwd: string
  turnId: string
  stepId?: string
  signal: AbortSignal
}

/**
 * Per-session contribution policy for a provider.
 * - `always` (default): run and contribute on every turn.
 * - `once`: contribute each `(provider, path)` pair at most once per session;
 *   a path already injected this session is suppressed until the session's
 *   surface is replaced (e.g. compaction) and the ledger is cleared.
 */
export type PromptMiddlewareProviderMode = 'always' | 'once'

export interface PromptMiddlewareProvider {
  name: string
  priority?: number
  timeoutMs?: number
  mode?: PromptMiddlewareProviderMode
  run(input: PromptMiddlewareInput): Promise<PromptRelatesContribution[]>
}

/** One registered provider plus its declarative `kind`; imperative providers carry none. */
export interface PromptMiddlewareProviderEntry {
  provider: PromptMiddlewareProvider
  kind?: string
}

/** One resolved path plus the full turn input, handed to a declarative `resolve`. */
export interface RelatesResolveContext {
  /** The single path this resolver call produces content for. */
  path: ResolvedPromptPath
  /** The whole-turn middleware input (cwd / signal / agent / session / turnId / stepId). */
  input: PromptMiddlewareInput
}

/** What a declarative resolver produces for one path. */
export interface RelatesResolveResult {
  value?: string
  href?: string
  meta?: Record<string, string>
}

/**
 * Declarative enrichment provider: the consumer declares how to resolve ONE
 * path plus a stable `kind`; the framework materializes it into an imperative
 * `PromptMiddlewareProvider` and reuses the shared runner (once ledger, merge/
 * dedupe, budget, timeout, cancel, failure degrade, trace, render).
 */
export interface DeclarativeRelatesProvider {
  /** Stable provider name, same PROVIDER_NAME validation as imperative providers. */
  name: string
  /** Stable item kind for this declaration; one declaration == one kind. */
  kind: string
  /** Transparently passed to the underlying provider (default 0). */
  priority?: number
  /** Transparently passed to the underlying provider (default providerTimeoutMs). */
  timeoutMs?: number
  /** Explicit `'always'` refreshes every turn; omitted means the default `'once'`. */
  mode?: 'always'
  /**
   * Optional pure projection of a mentioned path to the subject its content
   * renders under: the contribution group key AND the `once` ledger key. Must
   * return the mentioned path itself or one of its ancestor directories
   * (slash-canonical form), so sibling mentions sharing a subject collapse
   * into one group and one injection per session. Pure and synchronous — the
   * runner calls it before invoking `resolve` to keep the once pre-filter.
   */
  subjectOf?(path: ResolvedPromptPath): string
  /**
   * Resolve the enrichment for ONE mentioned path. Return `undefined` to skip
   * this path — and note a result whose `value`/`href` are both empty strings
   * is skipped the same way with no contribution and no error signal (trace
   * only), so prefer returning `undefined` explicitly over an empty string.
   */
  resolve(ctx: RelatesResolveContext): Promise<RelatesResolveResult | undefined>
}

export type PromptMiddlewareTraceStatus =
  | 'ok'
  | 'skipped'
  | 'failed'
  | 'timed-out'
  | 'cancelled'
  | 'truncated'

export interface PromptMiddlewareTraceEvent {
  provider: string
  status: PromptMiddlewareTraceStatus
  durationMs?: number
  pathsIn?: number
  itemsOut?: number
  reason?: string
}

export interface PromptMiddlewareConfig {
  providerTimeoutMs?: number
  totalTimeoutMs?: number
  renderBudgetChars?: number
}

export interface PromptMiddlewareRunOptions {
  prompt: string
  paths: ResolvedPromptPath[]
  agent: unknown
  session?: unknown
  /** Stable session identity scoping `once`-mode dedupe; absent means no dedupe scope. */
  sessionId?: string
  cwd: string
  turnId: string
  stepId?: string
  signal?: AbortSignal
  now?: () => number
  /** Provider names skipped this run (the switch mirror), filtered before `once` dedupe. */
  disabled?: ReadonlySet<string>
}

export interface PromptRelatesGroup {
  path: string
  items: RelatesItem[]
}

export interface PromptMiddlewareRunResult {
  paths: ResolvedPromptPath[]
  relates: PromptRelatesGroup[]
  text?: string
  trace: PromptMiddlewareTraceEvent[]
}

/** One row of the Settings → Plugins → Prompt Middleware tab's provider list. */
export interface PromptMiddlewareProviderView {
  name: string
  /** Item kind of a declarative provider; imperative providers have none. */
  kind?: string
  priority?: number
  timeoutMs?: number
  mode: 'always' | 'once'
  source: 'imperative' | 'declarative'
  enabled: boolean
}
