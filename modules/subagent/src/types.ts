/**
 * Shared contracts for the `subagent-at` plugin: the per-call cwd extension
 * on the subagent start request, and the deployment configuration.
 *
 * Seam note: `SubagentStartRequest` does not declare `cwd`; the registry
 * passes the request object through unchanged (only the four known
 * capability fields are validated), so the plugin's own tool and provider
 * exchange this extension within the plugin's own typed boundary. See the
 * package README for the graduation path toward an upstream contract field.
 *
 * @module @catheadowl/dsh-subagent-at/types
 */

import z from '@deepseek-ai/schemastery'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'

/**
 * The plugin-boundary start request: the seam contract plus one per-call
 * target directory. The tool layer resolves relative paths against the
 * parent session cwd before start, so providers always see an absolute path.
 */
export interface AtStartRequest extends SubagentStartRequest {
  /** Absolute target working directory the child runtime is started in. */
  readonly cwd?: string
}

/** Deployment configuration for the plugin (function-plugin `Config`). */
export interface Config {
  /** Provider registry name on `ctx.subagents` (default `dsh-sdk-at`). */
  providerName: string
  /** Model-facing tool name (default `subagent_at`). */
  toolName: string
  /**
   * Expose `run_in_background` (default true). Disabled instances omit the
   * parameter and reject forced background calls. Mirrors the native
   * `tool-subagent` config slot; the background route is the same parent-owned
   * Task on the host jobs seam.
   */
  enableRunInBackground?: boolean
  /** The child runtime executable (a `dsh-jsonrpc-agent` bin, packaged exe, or `node`). */
  command: string
  /** Arguments passed to {@link command} (typically the child's `cordis.yml` path). */
  args: string[]
  /** Provider route the child runtime initializes with (default `deepseek-official`). */
  provider: string
  /** Model the child runtime initializes with (default `deepseek-v4-flash`). */
  model: string
  /**
   * Extra environment variables ADDED for the child process on top of the
   * credential-scrubbed parent env (e.g. the child's own `DEEPSEEK_API_KEY`
   * or `DSH_CORDIS_CONFIG`).
   */
  env: Record<string, string>
  /** Bound (ms) on the protocol `shutdown` exchange during dispose. */
  shutdownTimeoutMs: number
  /** Grace period (ms) for the child's EOF-driven quiesce on dispose. */
  disposeEofGraceMs: number
  /** Termination confirmation window (ms), including forced exit. */
  disposeGraceMs: number
}

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 1_000
export const DEFAULT_DISPOSE_EOF_GRACE_MS = 6_000
export const DEFAULT_DISPOSE_GRACE_MS = 3_000

export const Config: z<Config> = z.object({
  providerName: z.string().default('dsh-sdk-at'),
  toolName: z.string().default('subagent_at'),
  enableRunInBackground: z.boolean().default(true),
  command: z.string().required(),
  args: z.array(z.string()).default([]),
  provider: z.string().default('deepseek-official'),
  model: z.string().default('deepseek-v4-flash'),
  env: z.dict(z.string()).default({}),
  shutdownTimeoutMs: z.number().default(DEFAULT_SHUTDOWN_TIMEOUT_MS),
  disposeEofGraceMs: z.number().default(DEFAULT_DISPOSE_EOF_GRACE_MS),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
})
