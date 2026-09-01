/**
 * Deferred-gate auto-repair: dispatch each failure's fixer off the main turn —
 * the "旁路执行" half of `defer`. A `subagent` fixer is fire-and-forget (the
 * child is published, not awaited to completion, and disposed when its result
 * settles); a `command` fixer runs synchronously here with a timeout.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'

import { buildFixerPrompt } from './core.js'
import type { GateFailure } from './core.js'
import { runCommand } from './repo-gates.js'

/**
 * Recursion cap for the fixer child: the child (depth 1) may run, but a
 * grandchild (depth 2) exceeds it, so a fixer child whose own turn-stop re-runs
 * a defer gate cannot dispatch another fixer — it degrades gracefully.
 */
const FIXER_MAX_DEPTH = 1

/** `ctx.subagents` provider to dispatch on (the fork provider's default name). */
const FIXER_PROVIDER = 'fork'

/** Safety bound for a command fixer: a hung repair must not wedge turn close, so it times out. */
const FIXER_COMMAND_TIMEOUT_MS = 120_000

export interface FixerDispatchOptions {
  /** The turn-stopping subject, used as the delegation parent. */
  agent: Agent
  /** Cancellation from the turn; not aborted at a normal turn close, so the child outlives the turn. */
  signal: AbortSignal
  /** Session workspace root: the command fixer's cwd. */
  root: string
  /** Test seam: override the command runner for command fixers; defaults to `runCommand`. */
  runCommand?: typeof runCommand
}

/**
 * Dispatch each failure's fixer. A `subagent` fixer hands the failure to a fork
 * subagent (fire-and-forget); a `command` fixer runs its command synchronously.
 * Never throws: rejections are logged to console.
 */
export async function dispatchFixer(
  ctx: Context,
  failures: readonly GateFailure[],
  options: FixerDispatchOptions,
): Promise<void> {
  for (const failure of failures) {
    const fixer = failure.definition.fixer
    if (fixer === undefined) continue
    if (fixer.kind === 'subagent') {
      const subagents = ctx.get('subagents') as SubagentRuntime | undefined
      if (subagents === undefined) continue
      const prompt = buildFixerPrompt(fixer, [failure])
      const request = fixer.request
      try {
        const run = await subagents.start(request?.provider ?? FIXER_PROVIDER, {
          label: `gates:fix:${failure.definition.id}`,
          prompt: [{ type: 'text', text: prompt }],
          parent: options.agent,
          signal: options.signal,
          maxDepth: FIXER_MAX_DEPTH,
          ...(request?.persona === undefined ? {} : { persona: request.persona }),
          ...(request?.toolFilter === undefined ? {} : { toolFilter: request.toolFilter }),
          ...(request?.agentOptions === undefined ? {} : { agentOptions: request.agentOptions }),
        })
        void run.result.then(
          (result) => {
            // A child-level failure RESOLVES with a non-`completed` stop reason
            // (model/transport errors do not reject `result`), so observe the
            // outcome here; only a seam-level infrastructure fault rejects.
            if (result.stopReason !== 'completed') {
              console.warn(`gates: fixer child for ${failure.definition.id} ended with ${result.stopReason}${result.diagnostic === undefined ? '' : ` (${result.diagnostic})`}`)
            }
          },
          (error: unknown) => {
            console.warn(`gates: fixer child for ${failure.definition.id} infrastructure fault: ${error instanceof Error ? error.message : String(error)}`)
          },
        ).finally(() => run.dispose()).catch(() => {})
      }
      catch (error) {
        console.warn(`gates: fixer dispatch for ${failure.definition.id} failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    else if (fixer.kind === 'command') {
      const execute = options.runCommand ?? runCommand
      try {
        const outcome = await execute(fixer.command, options.root, FIXER_COMMAND_TIMEOUT_MS, undefined)
        if (outcome.timedOut) {
          console.warn(`gates: fixer command for ${failure.definition.id} timed out after ${FIXER_COMMAND_TIMEOUT_MS}ms`)
        }
        else if (outcome.exitCode !== 0) {
          console.warn(`gates: fixer command for ${failure.definition.id} exited ${String(outcome.exitCode)}`)
        }
      }
      catch (error) {
        console.warn(`gates: fixer command for ${failure.definition.id} failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}
