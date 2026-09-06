/** Public prompt-middleware contracts. */

export type PromptPathKind = 'file' | 'directory'

export interface ResolvedPromptPath {
  /** Project-relative canonical path; directories do not keep a trailing slash. */
  path: string
  kind: PromptPathKind
  origin: 'prompt-parse' | string
  /** Tool that produced this path's touch; present only when origin is 'touch'. */
  touchTool?: string
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

/** Signal sources a provider consumes; omitted means prompt-only (v0 behavior). */
export type PromptMiddlewareSource = 'prompt' | 'touch'

/**
 * Session context handed to `touchSubjects` alongside the touched path. At
 * record time `cwd` is the session cwd the sensor normalized the path
 * against; at the pre-step consumption projection it is the current step's
 * `cwd`. `sessionId` is the touch-owning session when the caller has one.
 * Enables cwd-lookup projections (per-project subject spaces) while keeping
 * the "no hidden inputs" purity bar: everything the projection sees arrives
 * through this explicit argument pair.
 */
export interface TouchSubjectContext {
  cwd: string
  sessionId?: string
}

export interface PromptMiddlewareProvider {
  name: string
  /**
   * Human-readable one-liner shown in the Settings → Plugins → Prompt
   * Middleware tab. Authored by the provider itself (not localized); omitted
   * providers render name + meta only, exactly as before the field existed.
   */
  description?: string
  priority?: number
  timeoutMs?: number
  mode?: PromptMiddlewareProviderMode
  /**
   * Signal sources this provider consumes. Omitted or `['prompt']` keeps the
   * v0 behavior: only paths parsed from the user prompt reach `run`. Adding
   * `'touch'` feeds in pseudo-paths materialized from the tool-touch sensor
   * (`origin: 'touch'`, `touchTool` set). Subscription governs injection
   * consumption only — ledger invalidation below applies to every declarer.
   */
  sources?: PromptMiddlewareSource[]
  /**
   * Reverse projection of a touched path onto this provider's subjects: the
   * framework removes those subjects' `once`-ledger entries (invalidation,
   * runs for every declarer regardless of `sources`) and, when the provider
   * subscribes to `'touch'`, offers the subjects as pseudo-paths at the next
   * pre-step. Synchronous subject computation with no hidden inputs: no FS
   * access beyond what the declarer caches ahead, and the second argument is
   * the only context — declarers may consult it (e.g. a per-cwd config
   * lookup table) but should keep the call cheap. Returning an empty array
   * ignores the touch. Single-parameter declarations remain valid (the
   * context is additive). Declaring `'touch'` in `sources` without this is a
   * dead subscription and fails loud at registration.
   */
  touchSubjects?(touchedPath: string, context: TouchSubjectContext): string[]
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
  /** Author-facing one-liner carried into the materialized provider's view. */
  description?: string
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
   * Never applied to touch pseudo-paths: those ARE the subject already.
   */
  subjectOf?(path: ResolvedPromptPath): string
  /**
   * Signal sources this provider consumes; omitted means prompt-only. See
   * `PromptMiddlewareProvider.sources` — same contract, declarative face.
   */
  sources?: PromptMiddlewareSource[]
  /**
   * Reverse touch projection onto this provider's subjects; see
   * `PromptMiddlewareProvider.touchSubjects` — same contract, declarative face.
   */
  touchSubjects?(touchedPath: string, context: TouchSubjectContext): string[]
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
  /**
   * Observation-only signal attribution: `'touch'` when the provider's input
   * for this run included at least one touch pseudo-path, `'prompt'`
   * otherwise. Never affects execution.
   */
  source?: 'prompt' | 'touch'
  durationMs?: number
  pathsIn?: number
  itemsOut?: number
  reason?: string
}

export interface PromptMiddlewareConfig {
  providerTimeoutMs?: number
  totalTimeoutMs?: number
  renderBudgetChars?: number
  /**
   * Provider names disabled at the deployment level (config / profile patch) —
   * the headless-reachable second entry, unioned with the browser-owned switch
   * mirror so either surface saying "off" wins. Unknown names simply match
   * nothing (providers register after config loads, so this cannot be
   * pre-validated); skipped providers trace `disabled by config`.
   */
  disabledProviders?: string[]
}

export interface PromptMiddlewareRunOptions {
  prompt: string
  paths: ResolvedPromptPath[]
  /**
   * Settled tool touches taken from the session's pending set at this
   * pre-step. Providers subscribing to `'touch'` receive pseudo-paths
   * projected through their own `touchSubjects`; every declarer's ledger
   * invalidation already ran at record time.
   */
  touches?: ReadonlyArray<{ path: string; tool: string }>
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
  /**
   * Provider names disabled via plugin config (`disabledProviders`), kept
   * separate from `disabled` so the runner can attribute the skip: config
   * source traces `disabled by config`, user source `disabled by user`.
   * Checked before `disabled`; same filter position (before `once` dedupe).
   */
  configDisabled?: ReadonlySet<string>
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
  /** Provider-authored one-liner; absent when the provider declared none. */
  description?: string
  /** Item kind of a declarative provider; imperative providers have none. */
  kind?: string
  priority?: number
  timeoutMs?: number
  mode: 'always' | 'once'
  source: 'imperative' | 'declarative'
  enabled: boolean
}
