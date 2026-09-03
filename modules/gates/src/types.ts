/**
 * Gate contract: a gate is a self-describing work unit — check (read-only
 * detection) + rationale (why it exists and why manual repair is safe;
 * lazy-loaded into failure feedback only) + remedy (per-violation repair
 * pointer). Shape inherits the host `run-gates.ts` GateResult vocabulary.
 */
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'

/** Blocking failures steer another step at turn-stop; deferred failures stay in process-local dirty state without steering; advisory results are reported but never steer. */
export type GateLevel = 'blocking' | 'advisory' | 'defer'

/** When a gate runs. Vocabulary mirrors the hooks event table; the MVP ships two. */
export type GateTrigger = 'stop' | 'manual'

/** Manual repair is legitimate: the guidance states how and why it is safe. */
export interface GateRemedyManual {
  kind: 'manual'
  guidance: string
}

/** A dedicated repair operation exists as a tool; referenced by surface-neutral operation id only. */
export interface GateRemedyOperation {
  kind: 'operation'
  operation: string
}

/** The per-violation repair pointer: manual guidance or a surface-neutral operation id. */
export type GateRemedy = GateRemedyManual | GateRemedyOperation

/**
 * Context-free overlay fields a gate author may provide for a `subagent`
 * fixer, passed through verbatim to `ctx.subagents.start`. Gates owns the
 * turn facts (`parent`, `signal`, `label`, `maxDepth: 1`) and the failed-file
 * list appended to `prompt`; these four fields are the author's seam surface.
 */
export interface GateFixerSubagentRequest {
  /** Subagent provider name; defaults to `fork`. */
  provider?: string
  /** Per-child persona, shadowing the deployment persona (strict `{{…}}` interpolation). */
  persona?: string
  /** Child tool scoping (allow/deny), validated by the seam at start. */
  toolFilter?: ToolRestriction
  /** provider/model/maxTokens overrides for the child. */
  agentOptions?: AgentOptions
}

/**
 * Semantic repair for a `defer`-level gate: dispatch a subagent off the main
 * turn to fix the failure (the "旁路执行" half of defer). `prompt` is static
 * task text; the dispatcher appends the failed file list via `buildFixerPrompt`.
 */
export interface GateFixerSubagent {
  kind: 'subagent'
  /** Static task instruction; the dispatcher appends the failed file list. */
  prompt: string
  /** Optional seam request overlay (provider/persona/toolFilter/agentOptions). */
  request?: GateFixerSubagentRequest
}

/** Deterministic repair: run a shell command with the workspace root as cwd, synchronously with a timeout. */
export interface GateFixerCommand {
  kind: 'command'
  command: string
}

/** Repair strategy for a defer-level failure: a contextual subagent or a deterministic command. */
export type GateFixer = GateFixerSubagent | GateFixerCommand

/** One located problem, shaped so the model can fix it in one pass. */
export interface GateViolation {
  file?: string
  line?: number
  reason: string
  remedy?: GateRemedy
}

/** Terminal state of one gate run; a skipped gate reused a prior passed result or was cancelled before running. */
export type GateStatus = 'passed' | 'failed' | 'skipped'

/** Uniform result contract (inherits the host run-gates GateResult shape). */
export interface GateResult {
  gateId: string
  status: GateStatus
  durationMs: number
  violations: GateViolation[]
  error?: string
}

/**
 * Session-recorded change set handed to a gate's `check` (the W2 dirt window,
 * exposed as an input rather than only an internal shortcut hint). `paths` are
 * precise writes from `write`/`edit` tool calls since the last clean pass;
 * `opaque` is true when any unknown/possibly-writing tool ran, in which case
 * `paths` is known-incomplete. Absent on manual runs (no turn context).
 */
export interface GateChangeSet {
  paths: readonly string[]
  opaque: boolean
}

/**
 * One registered gate. Gates are read-only in `check`: they detect and report,
 * never repair — repair lives in the manual guidance, a separate tool, or an
 * optional `fixer` (a subagent or command dispatched on defer-level failure).
 */
export interface GateDefinition {
  /** kebab-case, globally unique; duplicates fail loud at registration. */
  id: string
  /** One-line summary for listings and summaries. */
  description: string
  /** Design note: why this check exists and why the manual repair is safe. Surfaced only on failure. */
  rationale: string
  on: GateTrigger[]
  level: GateLevel
  /** Hard cap for one check run; the runner fails the gate on expiry. */
  timeoutMs?: number
  /**
   * Optional relevance matcher for the incremental shortcut (W2): on a turn
   * whose only dirt is precise paths, a gate whose matcher matches none of
   * them may reuse its last passed result. Absent matcher = always rescan.
   */
  relevantPath?: (path: string) => boolean
  /** Optional auto-repair (subagent or command), dispatched on defer-level failure instead of only recording. */
  fixer?: GateFixer
  /** Pure detection; `root` is the session workspace root (a runtime fact). */
  check(root: string, changes?: GateChangeSet): Promise<GateViolation[]>
}

/**
 * One declarative gate entry (project `gates.yml` dialect; interim schema).
 * Exactly one of `module` / `command`.
 */
export interface ConfigGateEntry {
  id: string
  description?: string
  rationale?: string
  level?: 'blocking' | 'advisory' | 'defer'
  /** Hard cap for one check run; the default bounds hung checks at turn-stop. */
  timeoutMs?: number
  /** Incremental-shortcut relevance patterns (MVP grammar: `*.ext` suffix or substring). */
  relevant?: string[]
  /** Optional auto-repair (defer only); same shape as the plugin-side fixer. */
  fixer?: GateFixer
  /** In-process: module path relative to the session workspace root. */
  module?: string
  /** Shell: command run with the session workspace root as cwd; nonzero exit fails. */
  command?: string
}

