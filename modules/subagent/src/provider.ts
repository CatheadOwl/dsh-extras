/**
 * The `dsh-sdk-at` provider: an out-of-process subagent backend whose child
 * working directory is a PER-CALL request field instead of a deployment-time
 * override. Behavioral contract mirrors the host's `subagent-dsh-sdk`:
 * no start-time capabilities, no parent context inheritance, scrubbed env,
 * bounded teardown — the only difference is where the cwd comes from, and
 * that it is validated on every start (fail loud, never fall back).
 *
 * @module @catheadowl/dsh-subagent-at/provider
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  ResolvedSubagentStartRequest,
  SubagentCapabilities,
  SubagentProvider,
} from '@deepseek-ai/dsh-subagent'
import { assertUsableCwd, NO_START_CAPABILITIES } from '@deepseek-ai/dsh-subagent'
import { startAtRun, type AtRunSpec } from './run.js'
import type { AtStartRequest, Config } from './types.js'

export const PLUGIN_PREFIX = 'subagent-at'

/**
 * The provider. Advertises NO start-time capabilities: an out-of-process
 * child cannot honor `outputSchema`/`maxDepth`/`toolFilter`/`persona` (the
 * service rejects a request needing any of them before `start` runs).
 */
export class AtSdkSubagentProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = NO_START_CAPABILITIES
  // Context contract: an out-of-process child starts fresh — no parent
  // conversation crosses the process boundary.
  readonly inheritsParentContext = false

  constructor(readonly name: string, private readonly ctx: Context, private readonly config: Config) {}

  start(request: ResolvedSubagentStartRequest) {
    // The seam registry passes the request through unchanged; the plugin's
    // own tool attached the per-call target directory (see types.ts note).
    const cwd = (request as AtStartRequest).cwd
    if (cwd === undefined) {
      throw new Error(`${PLUGIN_PREFIX}: no per-call cwd on the request — start through the directory-targeted tool, which always supplies one`)
    }
    // Per-start validation (the deliberate difference from the host's
    // load-time `Config.cwd` check): the value arrives at call time, so it
    // is checked here — absolute, existing, enterable — and a failure aborts
    // this delegation instead of silently re-anchoring the child.
    const resolved = assertUsableCwd(PLUGIN_PREFIX, 'per-call cwd', cwd)
    const spec: AtRunSpec = {
      dshBin: this.config.dshBin,
      profile: this.config.profile,
      patches: this.config.patches,
      dshHome: this.config.dshHome,
      cwd: resolved,
      provider: this.config.provider,
      model: this.config.model,
      env: this.config.env,
      shutdownTimeoutMs: this.config.shutdownTimeoutMs,
      disposeEofGraceMs: this.config.disposeEofGraceMs,
      disposeGraceMs: this.config.disposeGraceMs,
      onError: (error, stopReason) => {
        // The seam forbids `result` rejecting, so a child-level failure is
        // flattened to a stop reason — preserve it here rather than losing it.
        this.ctx.logger.warn(`${PLUGIN_PREFIX} "${this.name}": child run failed (${stopReason}): ${error.message}`)
      },
    }
    return startAtRun(request, spec)
  }
}
