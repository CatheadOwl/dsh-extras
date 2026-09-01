/**
 * Pure gate mechanics: registry, serial runner, consecutive-block budget,
 * and failure-feedback formatting. No dsh and no node imports — directly
 * testable without a host process.
 */
import type { GateChangeSet, GateDefinition, GateFixerSubagent, GateLevel, GateResult, GateTrigger, GateViolation } from './types.js'

const GATE_ID = /^[a-z][a-z0-9-]*$/u
export const RESERVED_GATE_IDS: readonly string[] = ['gates-config']

const GATE_TRIGGERS: readonly GateTrigger[] = ['stop', 'manual']
const GATE_LEVELS: readonly GateLevel[] = ['blocking', 'advisory', 'defer']

/** Whitelist of `request` overlay fields a `subagent` fixer may pass through to the seam. */
const FIXER_REQUEST_KEYS: readonly string[] = ['provider', 'persona', 'toolFilter', 'agentOptions']

/** Gate ids are kebab-case discovery keys; malformed ids fail loud at registration. */
export function validateGateId(id: string): void {
  if (!GATE_ID.test(id)) {
    throw new Error(`gate id ${JSON.stringify(id)} must match ${GATE_ID}`)
  }
  if (RESERVED_GATE_IDS.includes(id)) {
    throw new Error(`gate id ${JSON.stringify(id)} is reserved`)
  }
}

/**
 * Boundary validation for structurally-typed registrants: unknown trigger or
 * level vocabulary would otherwise silence a gate (never fires / never blocks).
 * Applied on BOTH registration paths (plugin register and project materialization).
 */
export function validateGateDefinition(definition: GateDefinition): void {
  validateGateId(definition.id)
  for (const trigger of definition.on) {
    if (!GATE_TRIGGERS.includes(trigger)) {
      throw new Error(`gate ${JSON.stringify(definition.id)} declares unknown trigger ${JSON.stringify(trigger)} (allowed: ${GATE_TRIGGERS.join(', ')})`)
    }
  }
  if (!GATE_LEVELS.includes(definition.level)) {
    throw new Error(`gate ${JSON.stringify(definition.id)} declares unknown level ${JSON.stringify(definition.level)} (allowed: ${GATE_LEVELS.join(', ')})`)
  }
  if (definition.fixer !== undefined) {
    if (definition.level !== 'defer') {
      throw new Error(`gate ${JSON.stringify(definition.id)} declares a fixer but level ${JSON.stringify(definition.level)} — a fixer only fires on defer-level failures`)
    }
    const fixer = definition.fixer
    if (fixer.kind === 'subagent') {
      if (typeof fixer.prompt !== 'string' || fixer.prompt.trim() === '') {
        throw new Error(`gate ${JSON.stringify(definition.id)} declares a subagent fixer with a missing or empty prompt`)
      }
      const request = fixer.request
      if (request !== undefined) {
        // Config-gate requests come from YAML (`entry as ConfigGateEntry`), so a
        // null/primitive/array value reaches here at runtime and must fail loud,
        // not throw a bare `Object.keys` TypeError or pass silently.
        if (request === null || typeof request !== 'object' || Array.isArray(request)) {
          throw new Error(`gate ${JSON.stringify(definition.id)} declares a subagent fixer request that is not a mapping`)
        }
        for (const key of Object.keys(request)) {
          if (!FIXER_REQUEST_KEYS.includes(key)) {
            throw new Error(`gate ${JSON.stringify(definition.id)} declares a subagent fixer request with unknown field ${JSON.stringify(key)} (allowed: ${FIXER_REQUEST_KEYS.join(', ')})`)
          }
        }
      }
    }
    else if (fixer.kind === 'command') {
      if (typeof fixer.command !== 'string' || fixer.command.trim() === '') {
        throw new Error(`gate ${JSON.stringify(definition.id)} declares a command fixer with a missing or empty command`)
      }
    }
    else {
      const unknownKind = (fixer as { kind: string }).kind
      throw new Error(`gate ${JSON.stringify(definition.id)} declares unknown fixer kind ${JSON.stringify(unknownKind)}`)
    }
  }
}

export interface GateRegistry {
  /** Insert one gate; the returned disposer unregisters it. Duplicate ids fail loud. */
  register(definition: GateDefinition): () => void
  /** All registered gates in registration order. */
  list(): GateDefinition[]
  get(id: string): GateDefinition | undefined
}

export function createGateRegistry(): GateRegistry {
  const byId = new Map<string, GateDefinition>()
  return {
    register(definition) {
      validateGateDefinition(definition)
      if (byId.has(definition.id)) {
        throw new Error(`gate ${JSON.stringify(definition.id)} is already registered`)
      }
      byId.set(definition.id, definition)
      return () => {
        if (byId.get(definition.id) === definition) byId.delete(definition.id)
      }
    },
    list: () => [...byId.values()],
    get: id => byId.get(id),
  }
}

/** Gates opt into triggers; selection keeps registration order. */
export function selectGates(definitions: readonly GateDefinition[], trigger: GateTrigger): GateDefinition[] {
  return definitions.filter(definition => definition.on.includes(trigger))
}

/**
 * Definitions minus one trigger's user-disabled gate ids — the per-trigger
 * run view (compose with `selectGates` to bound by the author's `on`
 * declaration first). Order and vocabulary are preserved; unknown ids in the
 * disabled list match nothing.
 */
export function excludeDisabledGates(
  definitions: readonly GateDefinition[],
  disabledIds: Iterable<string>,
): GateDefinition[] {
  const disabled = new Set(disabledIds)
  return definitions.filter(definition => !disabled.has(definition.id))
}

function renderThrown(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

/** Bound one check run; expiry rejects with an attributable error. */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined, gateId: string): Promise<T> {
  if (timeoutMs === undefined) return promise
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`gate ${JSON.stringify(gateId)} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    timer.unref?.()
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

export interface RunGatesOptions {
  /** Turn/user cancellation; gates not yet started become `skipped`. */
  signal?: AbortSignal
  /** Session change set since the last clean pass, passed to each gate's check. */
  changes?: GateChangeSet
}

/** Run one gate with timing, timeout, and error containment; violations decide pass/fail. */
export async function runGate(definition: GateDefinition, root: string, options: RunGatesOptions = {}): Promise<GateResult> {
  options.signal?.throwIfAborted()
  const startedAt = Date.now()
  try {
    const violations = await withTimeout(definition.check(root, options.changes), definition.timeoutMs, definition.id)
    return {
      gateId: definition.id,
      status: violations.length === 0 ? 'passed' : 'failed',
      durationMs: Date.now() - startedAt,
      violations,
    }
  } catch (error) {
    return {
      gateId: definition.id,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      violations: [],
      error: renderThrown(error),
    }
  }
}

/** MVP scheduler: serial, registration order (graph scheduling is deferred). */
export async function runGates(
  definitions: readonly GateDefinition[],
  root: string,
  options: RunGatesOptions = {},
): Promise<GateResult[]> {
  const results: GateResult[] = []
  for (const definition of definitions) {
    if (options.signal?.aborted === true) {
      results.push({ gateId: definition.id, status: 'skipped', durationMs: 0, violations: [], error: 'aborted before run' })
      continue
    }
    results.push(await runGate(definition, root, options))
  }
  return results
}

/** One blocking failure with its definition, for feedback formatting. */
export interface GateFailure {
  definition: GateDefinition
  result: GateResult
}

/** Extract failures at one enforcement level from one run, preserving order. */
function collectFailuresByLevel(
  definitions: readonly GateDefinition[],
  results: readonly GateResult[],
  level: GateLevel,
): GateFailure[] {
  const byId = new Map(definitions.map(definition => [definition.id, definition]))
  const failures: GateFailure[] = []
  for (const result of results) {
    if (result.status !== 'failed') continue
    const definition = byId.get(result.gateId)
    if (definition === undefined || definition.level !== level) continue
    failures.push({ definition, result })
  }
  return failures
}

/** Extract blocking failures from one run, preserving order. */
export function collectBlockingFailures(
  definitions: readonly GateDefinition[],
  results: readonly GateResult[],
): GateFailure[] {
  return collectFailuresByLevel(definitions, results, 'blocking')
}

/** Extract deferred failures (level `defer`) from one run, preserving order. */
export function collectDeferredFailures(
  definitions: readonly GateDefinition[],
  results: readonly GateResult[],
): GateFailure[] {
  return collectFailuresByLevel(definitions, results, 'defer')
}

/**
 * Build the subagent task text for a subagent fixer: the gate's static
 * instruction followed by the failed file list (deduplicated, each with its
 * first violation reason). The file list is what makes the fixer target the
 * exact failing docs without the gate author hardcoding paths.
 */
export function buildFixerPrompt(fixer: GateFixerSubagent, failures: readonly GateFailure[]): string {
  const rows = new Map<string, string>()
  for (const failure of failures) {
    for (const violation of failure.result.violations) {
      if (violation.file === undefined || rows.has(violation.file)) continue
      rows.set(violation.file, violation.reason)
    }
  }
  const lines = [fixer.prompt]
  if (rows.size > 0) {
    lines.push('', 'Files to fix:', ...[...rows].map(([file, reason]) => `- ${file} — ${reason}`))
  }
  return lines.join('\n')
}

/**
 * Consecutive-block budget: steer while under `max`; once `max` forced
 * continuations accumulate, degrade to pass-through and restart the cycle.
 * The host Stop hook lacks this guard (TODO(stop-loop-guard)); gates own it.
 */
export interface BlockBudgetDecision {
  steer: boolean
  /** Consecutive forced continuations after this decision. */
  count: number
  /** True when the budget was exhausted and this failure passes instead. */
  degraded: boolean
}

export function nextBlockBudget(previousCount: number, blockingFailed: boolean, max: number): BlockBudgetDecision {
  if (!blockingFailed) return { steer: false, count: 0, degraded: false }
  if (previousCount >= max) return { steer: false, count: 0, degraded: true }
  return { steer: true, count: previousCount + 1, degraded: false }
}

const MAX_REPORTED_VIOLATIONS = 20

function formatViolationLocation(violation: GateViolation): string {
  if (violation.file === undefined) return ''
  return violation.line !== undefined ? `${violation.file}:${violation.line}: ` : `${violation.file}: `
}

/** Render one failure's per-gate section: rationale, violations, and remedies. */
function renderGateSections(failures: readonly GateFailure[]): string[] {
  const lines: string[] = []
  for (const { definition, result } of failures) {
    lines.push(
      '',
      `## gate: ${definition.id} — ${definition.description}`,
      '',
      'Why this gate exists:',
      definition.rationale,
      '',
      'Violations:',
    )
    const shown = result.violations.slice(0, MAX_REPORTED_VIOLATIONS)
    for (const violation of shown) {
      lines.push(`- ${formatViolationLocation(violation)}${violation.reason}`)
      if (violation.remedy?.kind === 'manual') lines.push(`  fix: ${violation.remedy.guidance}`)
      else if (violation.remedy?.kind === 'operation') lines.push(`  fix: run repair operation ${JSON.stringify(violation.remedy.operation)}`)
    }
    if (result.violations.length > shown.length) {
      lines.push(`- ...and ${result.violations.length - shown.length} more`)
    }
    if (result.error !== undefined) lines.push(`(gate error: ${result.error})`)
  }
  return lines
}

/**
 * Model-facing steer text: the rationale explains why each gate exists,
 * violations locate each problem, and the remedy states the legal repair.
 * Rationale is lazy-loaded exactly here — it never costs standing tokens.
 */
export function formatGateFailureFeedback(failures: readonly GateFailure[]): string {
  return [
    `gates: ${failures.length} blocking gate(s) failed. Fix these before finishing; each gate's rationale explains why the check exists.`,
    ...renderGateSections(failures),
  ].join('\n')
}

/** Human-facing one-line-per-gate summary for `/gates` and tool output. */
export function formatGateSummary(results: readonly GateResult[]): string {
  return results.map((result) => {
    const seconds = (result.durationMs / 1000).toFixed(2)
    if (result.status === 'passed') return `PASS ${result.gateId} (${seconds}s)`
    const detail = result.error !== undefined
      ? `error: ${result.error}`
      : `${result.violations.length} violation(s)`
    return `${result.status.toUpperCase()} ${result.gateId} (${seconds}s) ${detail}`
  }).join('\n')
}
