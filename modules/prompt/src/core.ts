import type {
  DeclarativeRelatesProvider,
  PromptMiddlewareConfig,
  PromptMiddlewareInput,
  PromptMiddlewareProvider,
  PromptMiddlewareProviderEntry,
  PromptMiddlewareRunOptions,
  PromptMiddlewareRunResult,
  PromptMiddlewareTraceEvent,
  PromptRelatesContribution,
  PromptRelatesGroup,
  RelatesItem,
  ResolvedPromptPath,
  TouchSubjectContext,
} from './types.js'
import type { RecordedTouch } from './sensor.js'

const PROVIDER_NAME = /^[a-z][a-z0-9-]*$/u
const DEFAULT_PROVIDER_TIMEOUT_MS = 2_000
const DEFAULT_TOTAL_TIMEOUT_MS = 5_000
const DEFAULT_RENDER_BUDGET_CHARS = 4_000

interface RegisteredProvider {
  provider: PromptMiddlewareProvider
  order: number
  /** Item kind of a declarative provider; imperative registrations carry none. */
  kind?: string
  /** Subject projection of a declarative provider; imperative registrations carry none. */
  subjectOf?: (path: ResolvedPromptPath) => string
}

export interface PromptMiddlewareRegistry {
  register(provider: PromptMiddlewareProvider): () => void
  list(): PromptMiddlewareProvider[]
}

/** Runner-facing registry view: also exposes priority-ordered entries carrying registration order. */
interface InternalPromptMiddlewareRegistry extends PromptMiddlewareRegistry {
  register(provider: PromptMiddlewareProvider, kind?: string, subjectOf?: (path: ResolvedPromptPath) => string): () => void
  listEntries(): RegisteredProvider[]
}

export function validateProvider(provider: PromptMiddlewareProvider): void {
  if (!PROVIDER_NAME.test(provider.name)) {
    throw new Error(`prompt-middleware provider name ${JSON.stringify(provider.name)} must match ${PROVIDER_NAME}`)
  }
  if (provider.priority !== undefined && !Number.isFinite(provider.priority)) {
    throw new Error(`prompt-middleware provider ${JSON.stringify(provider.name)} priority must be a finite number`)
  }
  if (provider.timeoutMs !== undefined && (!Number.isSafeInteger(provider.timeoutMs) || provider.timeoutMs <= 0)) {
    throw new Error(`prompt-middleware provider ${JSON.stringify(provider.name)} timeoutMs must be a positive safe integer`)
  }
  if (provider.mode !== undefined && provider.mode !== 'always' && provider.mode !== 'once') {
    throw new Error(`prompt-middleware provider ${JSON.stringify(provider.name)} mode must be 'always' or 'once'`)
  }
  if (provider.description !== undefined && (typeof provider.description !== 'string' || provider.description.trim() === '')) {
    throw new Error(`prompt-middleware provider ${JSON.stringify(provider.name)} description must be a non-empty string`)
  }
  if (provider.sources !== undefined) {
    if (!Array.isArray(provider.sources) || provider.sources.length === 0) {
      throw new Error(`prompt-middleware provider ${JSON.stringify(provider.name)} sources must be a non-empty array`)
    }
    for (const source of provider.sources) {
      if (source !== 'prompt' && source !== 'touch') {
        throw new Error(`prompt-middleware provider ${JSON.stringify(provider.name)} sources entries must be 'prompt' or 'touch'`)
      }
    }
    if (provider.sources.includes('touch') && provider.touchSubjects === undefined) {
      throw new Error(`prompt-middleware provider ${JSON.stringify(provider.name)} declares the touch source without a touchSubjects projection (dead subscription)`)
    }
  }
  if (provider.touchSubjects !== undefined && typeof provider.touchSubjects !== 'function') {
    throw new Error(`prompt-middleware provider ${JSON.stringify(provider.name)} touchSubjects must be a function`)
  }
}

function materializeRelatesProvider(decl: DeclarativeRelatesProvider): { provider: PromptMiddlewareProvider; kind: string; subjectOf?: (path: ResolvedPromptPath) => string } {
  if (typeof decl.kind !== 'string' || decl.kind === '') {
    throw new Error(`prompt-middleware declarative provider ${JSON.stringify(decl.name)} kind must be a non-empty string`)
  }
  // `mode` is typed `'always' | undefined`; widen so an untyped caller passing
  // anything else (including an explicit `'once'`) fails loud here instead of
  // materializing a non-conforming provider.
  const mode: string | undefined = decl.mode
  if (mode !== undefined && mode !== 'always') {
    throw new Error(`prompt-middleware declarative provider ${JSON.stringify(decl.name)} mode must be 'always' or omitted (once is the default)`)
  }
  if (decl.subjectOf !== undefined && typeof decl.subjectOf !== 'function') {
    throw new Error(`prompt-middleware declarative provider ${JSON.stringify(decl.name)} subjectOf must be a function`)
  }
  const provider: PromptMiddlewareProvider = {
    name: decl.name,
    ...decl.description !== undefined ? { description: decl.description } : {},
    ...decl.priority !== undefined ? { priority: decl.priority } : {},
    ...decl.timeoutMs !== undefined ? { timeoutMs: decl.timeoutMs } : {},
    ...decl.sources !== undefined ? { sources: decl.sources } : {},
    ...decl.touchSubjects !== undefined ? { touchSubjects: decl.touchSubjects } : {},
    mode: decl.mode ?? 'once',
    run: async (input) => {
      const contributions: PromptRelatesContribution[] = []
      for (const path of input.paths) {
        if (input.signal.aborted) break
        const result = await decl.resolve({ path, input })
        if (result === undefined || result === null) continue
        if ((result.value ?? '') === '' && (result.href ?? '') === '') continue
        contributions.push({
          // `subjectOf` never re-keys touch pseudo-paths: those ARE the
          // subject their projection produced, and re-keying would drift the
          // contribution off the key the ledger invalidation removed.
          path: decl.subjectOf !== undefined && path.origin !== 'touch' ? projectSubjectStrict(decl.subjectOf(path), path) : path.path,
          items: [{
            kind: decl.kind,
            label: decl.kind,
            ...result.value !== undefined ? { value: result.value } : {},
            ...result.href !== undefined ? { href: result.href } : {},
            ...result.meta !== undefined ? { meta: result.meta } : {},
          }],
        })
      }
      return contributions
    },
  }
  validateProvider(provider)
  return { provider, kind: decl.kind, ...decl.subjectOf !== undefined ? { subjectOf: decl.subjectOf } : {} }
}

/**
 * Canonicalize and validate a declared subject: it must be the mentioned path
 * itself or one of its ancestor directories, so a provider can only re-key
 * content under a path component the mention already sits inside. Throws —
 * inside the materialized `run`, so an invalid projection surfaces as the
 * provider's own `failed` trace without poisoning the turn.
 */
function projectSubjectStrict(subject: string, mentioned: ResolvedPromptPath): string {
  const canonical = canonicalPath(typeof subject === 'string' ? subject : '')
  if (canonical === '') {
    throw new Error(`subjectOf must return a non-empty path, got ${JSON.stringify(subject)} for ${JSON.stringify(mentioned.path)}`)
  }
  if (canonical !== mentioned.path && !mentioned.path.startsWith(`${canonical}/`)) {
    throw new Error(`subjectOf must return the mentioned path or an ancestor directory, got ${JSON.stringify(subject)} for ${JSON.stringify(mentioned.path)}`)
  }
  return canonical
}

/**
 * Pre-run subject key with a safe fallback: an invalid subject cannot break
 * the turn before the provider runs — the materialized `run` throws on the
 * same projection and reports it as the provider's `failed` trace, so the
 * fallback only needs to keep the pre-filter, group ordering, and the allowed
 * set conservative (the mentioned path itself). Key-only view over
 * `subjectAnchorOf`, the single source for the key AND its directory-ness.
 */
function subjectKeyOf(entry: RegisteredProvider, mentioned: ResolvedPromptPath): string {
  return subjectAnchorOf(entry, mentioned).key
}

export function createPromptMiddlewareRegistry(): PromptMiddlewareRegistry {
  let nextOrder = 0
  const byName = new Map<string, RegisteredProvider>()
  const registry: InternalPromptMiddlewareRegistry = {
    register(provider, kind, subjectOf) {
      validateProvider(provider)
      if (byName.has(provider.name)) {
        throw new Error(`prompt-middleware provider ${JSON.stringify(provider.name)} is already registered`)
      }
      byName.set(provider.name, {
        provider,
        order: nextOrder++,
        ...kind !== undefined ? { kind } : {},
        ...subjectOf !== undefined ? { subjectOf } : {},
      })
      return () => {
        const entry = byName.get(provider.name)
        if (entry?.provider === provider) byName.delete(provider.name)
      }
    },
    list() {
      return orderedProviders([...byName.values()]).map(entry => entry.provider)
    },
    listEntries() {
      return orderedProviders([...byName.values()])
    },
  }
  return registry
}

function orderedProviders(entries: readonly RegisteredProvider[]): RegisteredProvider[] {
  return [...entries].sort((a, b) => (a.provider.priority ?? 0) - (b.provider.priority ?? 0) || a.order - b.order)
}

function subscribesPrompt(provider: PromptMiddlewareProvider): boolean {
  return provider.sources?.includes('prompt') ?? true
}

function subscribesTouch(provider: PromptMiddlewareProvider): boolean {
  return provider.sources?.includes('touch') ?? false
}

/** The runner's numeric knobs — `disabledProviders` is service-owned, not runner config. */
type RunnerConfig = Required<Pick<PromptMiddlewareConfig, 'providerTimeoutMs' | 'totalTimeoutMs' | 'renderBudgetChars'>>

export class PromptMiddlewareRunner {
  private readonly registry = createPromptMiddlewareRegistry() as InternalPromptMiddlewareRegistry
  private readonly config: RunnerConfig
  /** Per-session ledger of already-injected `once`-mode provider paths. */
  private readonly injected = new Map<string, Set<string>>()
  /**
   * Per-session pending tool touches recorded by the sensor, consumed at the
   * next pre-step of the same turn and dropped at the turn boundary — they
   * never carry into a new turn.
   */
  private readonly pendingTouches = new Map<string, RecordedTouch[]>()

  constructor(config: PromptMiddlewareConfig = {}) {
    this.config = {
      providerTimeoutMs: config.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
      totalTimeoutMs: config.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS,
      renderBudgetChars: config.renderBudgetChars ?? DEFAULT_RENDER_BUDGET_CHARS,
    }
    for (const [key, value] of Object.entries(this.config)) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`prompt-middleware: ${key} must be a positive safe integer`)
      }
    }
  }

  register(provider: PromptMiddlewareProvider): () => void {
    return this.registry.register(provider)
  }

  /**
   * Materialize a declarative provider into an imperative one and register it.
   * Registration-time validation fails loud on an empty `kind`, on any
   * explicit `mode` other than `'always'` (once is the default), on a
   * non-function `subjectOf`, plus the shared name/priority/timeoutMs checks
   * via `validateProvider`.
   */
  registerRelates(provider: DeclarativeRelatesProvider): () => void {
    const { provider: imperative, kind, subjectOf } = materializeRelatesProvider(provider)
    return this.registry.register(imperative, kind, subjectOf)
  }

  list(): PromptMiddlewareProvider[] {
    return this.registry.list()
  }

  /** Registry entries with their declarative `kind`, in priority-then-registration order. */
  listEntries(): PromptMiddlewareProviderEntry[] {
    return this.registry.listEntries().map(({ provider, kind }) => ({
      provider,
      ...kind !== undefined ? { kind } : {},
    }))
  }

  /** Forget every injected path for one session, so `once` providers re-inject after a surface replacement. */
  clearSession(sessionId: string): void {
    this.injected.delete(sessionId)
  }

  /**
   * Record one settled tool touch against the session owning the root
   * execution. `context.cwd` is the session cwd the sensor normalized the
   * path against — it rides into every declarer's `touchSubjects` call so a
   * per-project subject space can project without guessing.
   */
  recordTouch(sessionId: string, touch: RecordedTouch, context: { cwd: string }): void {
    let pending = this.pendingTouches.get(sessionId)
    if (pending === undefined) {
      pending = []
      this.pendingTouches.set(sessionId, pending)
    }
    pending.push(touch)
    // Invalidation is open to every declarer, regardless of `sources`
    // subscription or switch state: a touch removes the subjects it maps to
    // from the once ledger, so the next consumption re-resolves them. One
    // declarer's projection bug must not poison the others' invalidation —
    // the blast radius is that declarer alone.
    const projectionContext: TouchSubjectContext = { cwd: context.cwd, sessionId }
    for (const entry of this.registry.listEntries()) {
      const touchSubjects = entry.provider.touchSubjects
      if (touchSubjects === undefined) continue
      let subjects: string[]
      try {
        subjects = touchSubjects(touch.path, projectionContext)
      } catch {
        continue
      }
      for (const subject of subjects) {
        this.injected.get(sessionId)?.delete(`${entry.provider.name}\u0000${canonicalPath(subject)}`)
      }
    }
  }

  /** Take and clear the session's pending touches — the pre-step consumption point. */
  takePendingTouches(sessionId: string): RecordedTouch[] {
    const pending = this.pendingTouches.get(sessionId)
    this.pendingTouches.delete(sessionId)
    return pending ?? []
  }

  /** Drop residual touches at the turn boundary; aborted-turn leftovers never reach a new turn. */
  discardPendingTouches(sessionId: string): void {
    this.pendingTouches.delete(sessionId)
  }

  private markInjected(sessionId: string, providerName: string, path: string): void {
    let seen = this.injected.get(sessionId)
    if (seen === undefined) {
      seen = new Set()
      this.injected.set(sessionId, seen)
    }
    seen.add(`${providerName}\u0000${path}`)
  }

  private isInjected(sessionId: string, providerName: string, path: string): boolean {
    return this.injected.get(sessionId)?.has(`${providerName}\u0000${path}`) ?? false
  }

  async run(options: PromptMiddlewareRunOptions): Promise<PromptMiddlewareRunResult> {
    const trace: PromptMiddlewareTraceEvent[] = []
    const promptPaths = dedupePaths(options.paths, trace)
    const touches = options.touches ?? []
    const providers = this.registry.listEntries()
    // Per-provider touch anchors: pseudo-paths materialized through the
    // provider's own `touchSubjects` projection, deduped per provider.
    // Subscribing to 'touch' without a projection is rejected at
    // registration, so the guard below only short-circuits prompt-only
    // providers (whose anchors stay empty).
    const touchAnchors: ResolvedPromptPath[][] = providers.map((entry) => {
      const touchSubjects = entry.provider.touchSubjects
      if (!subscribesTouch(entry.provider) || touchSubjects === undefined) return []
      const anchors: ResolvedPromptPath[] = []
      const seen = new Set<string>()
      // Same context contract as the record-time invalidation projection:
      // cwd is the current step's session cwd, sessionId the run's scope.
      const projectionContext: TouchSubjectContext = {
        cwd: options.cwd,
        ...options.sessionId !== undefined ? { sessionId: options.sessionId } : {},
      }
      for (const touch of touches) {
        let subjects: string[]
        try {
          subjects = touchSubjects(touch.path, projectionContext)
        } catch (error) {
          // A provider's projection bug must neither break the host pre-step
          // chain nor poison other declarers: this provider sits the batch
          // out with a `failed` trace, mirroring how `run` throws are
          // contained per provider.
          trace.push({ provider: entry.provider.name, status: 'failed', source: 'touch', reason: renderThrown(error) })
          return []
        }
        for (const raw of subjects) {
          const path = canonicalPath(raw)
          if (path === '' || seen.has(path)) continue
          seen.add(path)
          anchors.push({ path, kind: 'file', origin: 'touch', touchTool: touch.tool })
        }
      }
      return anchors
    })
    if (promptPaths.length === 0 && touches.length === 0) {
      return { paths: promptPaths, relates: [], trace }
    }

    const input: PromptMiddlewareInput = {
      prompt: options.prompt,
      paths: promptPaths,
      agent: options.agent,
      ...options.session !== undefined ? { session: options.session } : {},
      cwd: options.cwd,
      turnId: options.turnId,
      ...options.stepId !== undefined ? { stepId: options.stepId } : {},
      signal: options.signal ?? new AbortController().signal,
    }
    const now = options.now ?? (() => Date.now())
    const totalDeadline = now() + this.config.totalTimeoutMs
    const accepted: AcceptedItem[] = []
    for (const [providerIndex, entry] of providers.entries()) {
      const provider = entry.provider
      const anchors = touchAnchors[providerIndex] ?? []
      const effectivePaths = subscribesPrompt(provider)
        ? anchors.length === 0 ? promptPaths : [...promptPaths, ...anchors]
        : anchors
      // Nothing this provider subscribes to arrived this step: no execution,
      // no trace row (v0 skipped empty batches the same way, before any
      // provider ran).
      if (effectivePaths.length === 0) continue
      // Observation-only attribution: a batch including any touch pseudo-path
      // traces as 'touch'; never affects execution.
      const source: 'prompt' | 'touch' = anchors.length > 0 ? 'touch' : 'prompt'
      // Switch is the contract: a disabled provider never runs. Filtering sits
      // before the once-dedupe check, so a disabled `once` provider neither
      // re-checks nor marks the ledger. The config-owned set is checked first
      // so the skip is attributed to its source (config vs user).
      if (options.configDisabled?.has(provider.name)) {
        trace.push({ provider: provider.name, status: 'skipped', source, pathsIn: effectivePaths.length, reason: 'disabled by config' })
        continue
      }
      if (options.disabled?.has(provider.name)) {
        trace.push({ provider: provider.name, status: 'skipped', source, pathsIn: effectivePaths.length, reason: 'disabled by user' })
        continue
      }
      if (input.signal.aborted) {
        trace.push({ provider: provider.name, status: 'cancelled', source, pathsIn: effectivePaths.length, reason: 'aborted before run' })
        continue
      }
      const remaining = totalDeadline - now()
      if (remaining <= 0) {
        trace.push({ provider: provider.name, status: 'skipped', source, pathsIn: effectivePaths.length, reason: `total timeout ${this.config.totalTimeoutMs}ms exceeded` })
        continue
      }
      const sessionScope = provider.mode === 'once' ? options.sessionId : undefined
      let providerInput: PromptMiddlewareInput = { ...input, paths: effectivePaths }
      if (sessionScope !== undefined) {
        // Once-ledger keys sit on the subject (the declared projection), not
        // the raw mention: a sibling of an already-injected subject is
        // suppressed too, which is the point of subject re-keying. Touch
        // pseudo-paths key as themselves — their projection already ran.
        const filteredPaths = effectivePaths.filter((p) => !this.isInjected(sessionScope, provider.name, subjectKeyOf(entry, p)))
        if (filteredPaths.length === 0 && effectivePaths.length > 0) {
          trace.push({ provider: provider.name, status: 'skipped', source, pathsIn: effectivePaths.length, reason: 'all paths already injected this session' })
          continue
        }
        providerInput = { ...input, paths: filteredPaths }
      }
      const { contributions, event } = await runProvider(provider, providerInput, Math.min(provider.timeoutMs ?? this.config.providerTimeoutMs, remaining), now)
      event.source = source
      trace.push(event)
      if (contributions === undefined) continue
      const normalized = normalizeContributions(provider, providerIndex, entry, contributions, providerInput.paths, trace)
      accepted.push(...normalized)
    }

    const merged = mergeRelates(orderedGroupAnchors(promptPaths, touchAnchors, providers), accepted)
    const relates = merged.groups
    const rendered = renderRelates(relates, this.config.renderBudgetChars)
    // Mark `once`-mode items injected only when they were actually rendered.
    // Items truncated by the render budget stay unmarked, so a later, roomier
    // turn re-offers their path to the provider (a chronically-truncated path
    // recomputes every turn; the once-dedup compute saving does not apply to it).
    for (const survivor of merged.survivors.slice(0, rendered.renderedItems)) {
      const entry = providers[survivor.providerIndex]
      if (entry.provider.mode === 'once' && options.sessionId !== undefined) {
        this.markInjected(options.sessionId, entry.provider.name, survivor.path)
      }
    }
    if (rendered.truncated) {
      trace.push({
        provider: 'prompt-middleware',
        status: 'truncated',
        pathsIn: promptPaths.length,
        itemsOut: rendered.renderedItems,
        reason: `render budget ${this.config.renderBudgetChars} chars exceeded`,
      })
    }
    return {
      paths: promptPaths,
      relates,
      ...rendered.text !== undefined ? { text: rendered.text } : {},
      trace,
    }
  }
}

interface ProviderRunResult {
  contributions?: PromptRelatesContribution[]
  event: PromptMiddlewareTraceEvent
}

async function runProvider(
  provider: PromptMiddlewareProvider,
  input: PromptMiddlewareInput,
  timeoutMs: number,
  now: () => number,
): Promise<ProviderRunResult> {
  const startedAt = now()
  try {
    const contributions = await withTimeout(provider.run(input), timeoutMs, provider.name)
    if (input.signal.aborted) {
      return {
        event: {
          provider: provider.name,
          status: 'cancelled',
          durationMs: now() - startedAt,
          pathsIn: input.paths.length,
          reason: 'aborted after run',
        },
      }
    }
    return {
      contributions,
      event: {
        provider: provider.name,
        status: 'ok',
        durationMs: now() - startedAt,
        pathsIn: input.paths.length,
        itemsOut: countItems(contributions),
      },
    }
  } catch (error) {
    const message = renderThrown(error)
    const timedOut = message.includes(`timed out after ${timeoutMs}ms`)
    return {
      event: {
        provider: provider.name,
        status: input.signal.aborted ? 'cancelled' : timedOut ? 'timed-out' : 'failed',
        durationMs: now() - startedAt,
        pathsIn: input.paths.length,
        reason: message,
      },
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, provider: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`provider ${JSON.stringify(provider)} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    timer.unref?.()
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))) },
    )
  })
}

function renderThrown(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function countItems(contributions: readonly PromptRelatesContribution[]): number {
  return contributions.reduce((total, contribution) => total + contribution.items.length, 0)
}

function dedupePaths(paths: readonly ResolvedPromptPath[], trace: PromptMiddlewareTraceEvent[]): ResolvedPromptPath[] {
  const seen = new Set<string>()
  const out: ResolvedPromptPath[] = []
  for (const path of paths) {
    const canonical = canonicalPath(path.path)
    if (canonical === '') {
      trace.push({ provider: 'path-resolver', status: 'skipped', reason: 'empty resolved path discarded' })
      continue
    }
    if (seen.has(canonical)) {
      trace.push({ provider: 'path-resolver', status: 'skipped', reason: `duplicate path ${JSON.stringify(canonical)} discarded` })
      continue
    }
    seen.add(canonical)
    out.push({ ...path, path: canonical })
  }
  return out
}

interface AcceptedItem {
  providerIndex: number
  providerOrder: number
  registrationOrder: number
  path: string
  item: RelatesItem
}

function normalizeContributions(
  provider: PromptMiddlewareProvider,
  providerIndex: number,
  entry: RegisteredProvider,
  contributions: readonly PromptRelatesContribution[],
  paths: readonly ResolvedPromptPath[],
  trace: PromptMiddlewareTraceEvent[],
): AcceptedItem[] {
  // A declarative provider with a subject projection may key its contribution
  // by the projected subject instead of the mention; both stay anchored to
  // what was actually mentioned. Imperative providers keep the mention-only rule.
  const allowed = new Set(paths.map(path => subjectKeyOf(entry, path)))
  const out: AcceptedItem[] = []
  let providerOrder = 0
  for (const contribution of contributions) {
    const path = canonicalPath(contribution.path)
    if (!allowed.has(path)) {
      trace.push({ provider: provider.name, status: 'skipped', reason: `unknown path ${JSON.stringify(contribution.path)} discarded` })
      continue
    }
    for (const item of contribution.items) {
      if (!isValidRelatesItem(item)) {
        trace.push({ provider: provider.name, status: 'skipped', reason: `invalid relates item for ${JSON.stringify(path)} discarded` })
        continue
      }
      out.push({ providerIndex, providerOrder: providerOrder++, registrationOrder: entry.order, path, item: normalizeRelatesItem(item) })
    }
  }
  return out
}

function isValidRelatesItem(item: unknown): item is RelatesItem {
  if (typeof item !== 'object' || item === null) return false
  const candidate = item as RelatesItem
  return typeof candidate.kind === 'string' && candidate.kind !== ''
    && typeof candidate.label === 'string' && candidate.label !== ''
    && (candidate.value === undefined || typeof candidate.value === 'string')
    && (candidate.href === undefined || typeof candidate.href === 'string')
}

function normalizeRelatesItem(item: RelatesItem): RelatesItem {
  return {
    kind: item.kind,
    label: item.label,
    ...item.value !== undefined ? { value: item.value } : {},
    ...item.href !== undefined ? { href: item.href } : {},
    ...item.meta !== undefined ? { meta: { ...item.meta } } : {},
  }
}

interface MergeRelatesResult {
  groups: PromptRelatesGroup[]
  /** Dedupe winners in render order: `paths` argument order, then `(providerIndex, providerOrder)` within a path. */
  survivors: AcceptedItem[]
}

function mergeRelates(anchors: readonly GroupAnchor[], items: readonly AcceptedItem[]): MergeRelatesResult {
  // Insertion-ordered: anchors follow the first mention that anchored them.
  const groups = new Map<string, RelatesItem[]>(anchors.map((anchor) => [anchor.key, []]))
  // Precedence: for each dedupe key, keep the earliest-registered contributor,
  // independent of priority.
  const winners = new Map<string, AcceptedItem>()
  for (const accepted of items) {
    const key = `${accepted.path}\0${accepted.item.kind}\0${accepted.item.href ?? accepted.item.value ?? ''}`
    const current = winners.get(key)
    if (current === undefined || accepted.registrationOrder < current.registrationOrder) {
      winners.set(key, accepted)
    }
  }
  // Render order: group keys follow the first mention that anchors them (path
  // order, then provider order at that mention); within a group, items sort by
  // (providerIndex, providerOrder) — the order they appear in the final groups.
  // The runner relies on it to mark `once` items injected only when rendered.
  const survivors: AcceptedItem[] = []
  for (const groupPath of groups.keys()) {
    const byPath = [...winners.values()]
      .filter(accepted => accepted.path === groupPath)
      .sort((a, b) => a.providerIndex - b.providerIndex || a.providerOrder - b.providerOrder)
    for (const accepted of byPath) {
      groups.get(accepted.path)?.push(accepted.item)
      survivors.push(accepted)
    }
  }
  return {
    groups: anchors
      .filter((anchor) => (groups.get(anchor.key)?.length ?? 0) > 0)
      .map((anchor) => ({
        path: anchor.key,
        ...anchor.display !== anchor.key ? { display: anchor.display } : {},
        items: groups.get(anchor.key)!,
      })),
    survivors,
  }
}

/**
 * Subject anchor of one mention for one entry, computed from a SINGLE
 * `subjectOf` invocation: the identity key plus whether that key names a
 * directory (the render form's trailing `/`). Directory-ness is read here —
 * the key-creation point — because that is the last place the structural
 * fact is visible: the key itself is a slash-stripped canonical string, and
 * projections produce ancestor-directory keys that never existed with their
 * slash. One invocation also guarantees a (possibly impure) projection can
 * never make the key and the display disagree.
 */
function subjectAnchorOf(entry: RegisteredProvider, mentioned: ResolvedPromptPath): { key: string; directory: boolean } {
  // A touch pseudo-path IS the subject its projection produced: applying
  // `subjectOf` again could re-key it somewhere the invalidation never
  // touched, so the once key and the ledger stay identical. Anchors
  // materialize as files.
  if (mentioned.origin === 'touch') return { key: canonicalPath(mentioned.path), directory: false }
  if (entry.subjectOf === undefined) return { key: mentioned.path, directory: mentioned.kind === 'directory' }
  try {
    const projected = projectSubjectStrict(entry.subjectOf(mentioned), mentioned)
    // An ancestor projection is a directory by construction; the identity
    // projection keeps the mentioned path's own kind.
    return projected === mentioned.path
      ? { key: projected, directory: mentioned.kind === 'directory' }
      : { key: projected, directory: true }
  } catch {
    // Invalid projection: both the key and the display degrade to the
    // mentioned path (the materialized `run` reports the throw as the
    // provider's own `failed` trace).
    return { key: mentioned.path, directory: mentioned.kind === 'directory' }
  }
}

/**
 * Group anchors in render order: prompt mentions stay mention-major (each
 * mention anchors every prompt-subscribed entry's key before the next
 * mention), then each entry's touch anchors follow in entry order. Keys use
 * the mention itself, its declared subject projection, or the touch subject
 * as-is; subject projections collapse sibling mentions onto one key at its
 * first anchor. Each anchor also carries its display form (directory keys
 * gain a trailing `/`) — identity and render form are decided together so
 * they can never disagree about which path they name.
 */
interface GroupAnchor {
  /** Identity: canonical path, dedupe/ledger coordinate — no trailing slash. */
  key: string
  /** Render form: `key` plus `/` when the key names a directory. */
  display: string
}

function orderedGroupAnchors(
  promptPaths: readonly ResolvedPromptPath[],
  touchAnchors: readonly (readonly ResolvedPromptPath[])[],
  entries: readonly RegisteredProvider[],
): GroupAnchor[] {
  const seen = new Set<string>()
  const anchors: GroupAnchor[] = []
  const add = (entry: RegisteredProvider, path: ResolvedPromptPath): void => {
    const { key, directory } = subjectAnchorOf(entry, path)
    if (!seen.has(key)) {
      seen.add(key)
      anchors.push({ key, display: directory ? `${key}/` : key })
    }
  }
  for (const path of promptPaths) {
    for (const entry of entries) {
      if (!subscribesPrompt(entry.provider)) continue
      add(entry, path)
    }
  }
  for (const [index, entry] of entries.entries()) {
    for (const anchor of touchAnchors[index] ?? []) {
      add(entry, anchor)
    }
  }
  return anchors
}

interface RenderResult {
  text?: string
  renderedItems: number
  truncated: boolean
}

export function renderRelates(relates: readonly PromptRelatesGroup[], budgetChars = DEFAULT_RENDER_BUDGET_CHARS): RenderResult {
  if (relates.length === 0) return { renderedItems: 0, truncated: false }
  const lines = ['relates:']
  let renderedItems = 0
  let truncated = false
  outer: for (const group of relates) {
    const groupLines = [`  ${group.display ?? group.path}:`]
    for (const item of group.items) {
      const detail = item.value ?? item.href ?? ''
      const suffix = detail === '' ? '' : ` ${detail}`
      const metaSuffix = renderMetaSuffix(item.meta)
      groupLines.push(`    - [${item.kind}]${suffix}${metaSuffix}`)
      const candidate = [...lines, ...groupLines].join('\n')
      if (candidate.length > budgetChars) {
        truncated = true
        break outer
      }
      renderedItems += 1
    }
    lines.push(...groupLines)
  }
  if (renderedItems === 0) return { renderedItems, truncated: true }
  if (truncated) {
    const note = '  ...truncated by render budget'
    if ([...lines, note].join('\n').length <= budgetChars) lines.push(note)
  }
  return { text: lines.join('\n'), renderedItems, truncated }
}

/**
 * Model-visible meta annotation suffix: ` (key=value, key2)` appended after `<detail>`.
 * Framework is key-agnostic — renders every entry present on the item's meta, in
 * insertion order, separated by comma + space. `value === 'true'` omits `=value`.
 * Envelope integrity is the framework's job: `\n`/`\r` in keys and values collapse
 * to spaces before rendering; all other characters pass through untouched.
 */
function renderMetaSuffix(meta: Record<string, string> | undefined): string {
  if (meta === undefined) return ''
  const entries = Object.entries(meta)
  if (entries.length === 0) return ''
  const parts = entries.map(([key, value]) => {
    const k = collapseNewlines(key)
    const rendered = k === '' ? '' : value === 'true' ? k : `${k}=${collapseNewlines(value)}`
    return rendered
  }).filter(part => part !== '')
  if (parts.length === 0) return ''
  return ` (${parts.join(', ')})`
}

function collapseNewlines(text: string): string {
  return text.replace(/[\n\r]/gu, ' ')
}

function canonicalPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/u, '')
}
