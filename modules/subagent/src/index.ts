/**
 * Directory-targeted subagent delegation for dsh.
 *
 * One functional plugin, two registrations (the handbook 07 single-package
 * fold): the `dsh-sdk-at` provider on the `ctx.subagents` seam, and the
 * model-facing `subagent_at` tool that always attaches a per-call target
 * directory. The child is a complete dsh runtime in its own process, started
 * IN that directory, so its session workspace (and therefore its AGENTS.md /
 * CLAUDE.md discovery chain) is rooted at the target folder — "a session
 * launched from that directory", without touching host contracts.
 *
 * v1 scope: one-shot runs only — foreground by default, or a parent-owned
 * background Task on the host jobs seam when `run_in_background: true`
 * (no continuable children) — see the package README for the recorded decisions.
 *
 * @module @catheadowl/dsh-subagent-at
 */

import { isAbsolute, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import { assertPositiveFinite, settleRun } from '@deepseek-ai/dsh-subagent'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import { AtSdkSubagentProvider, PLUGIN_PREFIX } from './provider.js'
import { PROMPT_DESCRIPTION, SYSTEM_PROMPT_TEXT, toolDescription } from './wording.js'
import type { AtStartRequest, Config } from './types.js'

export const name = 'subagent-at'
export const inject = ['tools', 'subagents', 'systemPrompt']
export { Config } from './types.js'

// Loader-contract entry only (ADR 0001): wording SSOT lives in ./wording.js
// (consumed by the drift-guard test); AtStartRequest stays in ./types.js.

/**
 * Settle pending startup without rejecting the task producer contract.
 * Mirrors the native `tool-subagent` `settleStart` (SSOT line 112).
 */
async function settleStart(start: Promise<SubagentRun>, signal: AbortSignal): Promise<JobOutcome> {
  try {
    return await settleRun(await start)
  } catch (error: unknown) {
    // Product providers aggregate startup and rollback failures. Cancellation
    // must not turn a failed cleanup into a cleanly killed Job.
    return signal.aborted && !(error instanceof AggregateError)
      ? { status: 'killed' }
      : { status: 'failed', detail: String(error) }
  }
}

/** Render text blocks from the canonical JSON block array without trusting arbitrary values. */
function outputValueText(values: JsonValue[]): string {
  return values
    .filter((value): value is { type: 'text'; text: string } =>
      typeof value === 'object' && value !== null && !Array.isArray(value)
      && value.type === 'text' && typeof value.text === 'string')
    .map(value => value.text)
    .join('')
}

/** A non-`completed` stop reason means the child did not finish cleanly. */
function stopReasonError(result: SubagentResult): string | undefined {
  switch (result.stopReason) {
    case 'completed':
      return undefined
    case 'aborted':
      return 'subagent run was cancelled'
    case 'error':
      return 'subagent run failed'
    case 'max-tokens':
      return 'subagent run hit its token limit before finishing'
    case 'refusal':
      return 'subagent declined the task'
    // Merge-extensible union: treat an unknown terminal reason as a failure
    // rather than reporting partial output as success.
    default:
      return `subagent run ended abnormally (${String(result.stopReason)})`
  }
}

/** Append provider diagnostic and the child's preserved partial answer to a failure headline. */
function withDiagnosticAndPartialText(error: string, result: SubagentResult): string {
  const diagnostic = result.diagnostic === undefined
    ? ''
    : `\nDiagnostic: ${result.diagnostic}`
  const text = result.output
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
  const partial = text.length === 0
    ? ''
    : `\nPartial output before the run ended:\n${text}`
  return `${error}${diagnostic}${partial}`
}

/**
 * Settle one foreground run: collect the terminal result, map non-completion
 * to an error-carrying tool result (partial output preserved), and always
 * dispose the child process afterwards.
 */
async function settleForegroundRun(run: SubagentRun): Promise<string> {
  const [execution] = await Promise.allSettled([
    run.result.then((result): string => {
      const error = stopReasonError(result)
      if (error !== undefined) {
        // The registry converts this throw to isError; the preserved partial
        // answer still reaches the parent.
        throw new Error(withDiagnosticAndPartialText(error, result))
      }
      return outputValueText(result.output as unknown as JsonValue[])
    }),
  ])
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])
  if (execution.status === 'rejected') {
    if (disposal.status === 'rejected') {
      throw new AggregateError(
        [execution.reason, disposal.reason],
        `${PLUGIN_PREFIX}: run failed: ${String(execution.reason)}; dispose failed: ${String(disposal.reason)}`,
      )
    }
    throw execution.reason
  }
  if (disposal.status === 'rejected') throw disposal.reason
  return execution.value
}

/**
 * Resolve the model's `cwd` slot against the parent session workspace.
 * Relative paths anchor on the session cwd (never the server launch
 * directory); an absent session cwd rejects instead of guessing.
 */
function resolveTargetCwd(requested: string, parentCwd: string | undefined): string {
  if (requested === '') {
    throw new Error(`${PLUGIN_PREFIX}: cwd must not be empty`)
  }
  if (isAbsolute(requested)) return requested
  if (parentCwd === undefined) {
    throw new Error(`${PLUGIN_PREFIX}: cannot resolve relative cwd "${requested}" — the parent session has no workspace cwd; pass an absolute path`)
  }
  return resolve(parentCwd, requested)
}

export function apply(ctx: Context, config: Config): void {
  assertPositiveFinite(PLUGIN_PREFIX, 'shutdownTimeoutMs', config.shutdownTimeoutMs)
  assertPositiveFinite(PLUGIN_PREFIX, 'disposeEofGraceMs', config.disposeEofGraceMs)
  assertPositiveFinite(PLUGIN_PREFIX, 'disposeGraceMs', config.disposeGraceMs)
  const backgroundEnabled = config.enableRunInBackground !== false

  ctx.subagents.registerProvider(new AtSdkSubagentProvider(config.providerName, ctx, config))

  ctx.tools.register(defineTool({
    name: config.toolName,
    // Native one-shot wording + the directory-targeting hint only, so a model
    // seeing both `subagent` and this tool gets one familiar sentence plus one
    // explicit routing condition (different directory => this tool).
    description: toolDescription(backgroundEnabled),
    parameters: {
      description: {
        type: 'string',
        required: true,
        description: 'A short (3-5 word) description of the delegated task, for display.',
      },
      prompt: {
        type: 'string',
        required: true,
        description: PROMPT_DESCRIPTION,
      },
      cwd: {
        type: 'string',
        required: true,
        description:
          'Target working directory the subagent is started in. Absolute paths are used '
          + 'as-is; relative paths resolve against the current session workspace. The '
          + 'directory must exist.',
      },
      ...backgroundEnabled ? {
        run_in_background: {
          type: 'boolean' as const,
          description:
            'Whether to run as a background job and return its id. Defaults to false; '
            + 'collect with job_output or stop with job_kill.',
        },
      } : {},
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'background' },
              jobId: { type: 'string', required: true },
            },
          },
          {
            type: 'string',
          },
        ],
      },
      render: (_args, value) => [{
        type: 'text',
        text: typeof value === 'string'
          ? value
          : `started background subagent job ${value.jobId}`,
      }],
    },
    // The child never mutates the parent session; one parent-owned foreground
    // delegation at a time is the only state, and a background start is a
    // synchronous commutative insertion into the jobs registry.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parent = exec.agent
      if (!parent) {
        // Non-agent callers provide no parent for delegation ownership.
        throw new Error(`${PLUGIN_PREFIX}: tool requires a calling agent (exec.agent was undefined)`)
      }
      // Route first (mirrors the native resolveDelegationRun): a forced
      // background call on a disabled instance is refused before any slot
      // work, so the error names the scheduling refusal, not a cwd problem.
      if (!backgroundEnabled && args.run_in_background === true) {
        // The validator permits undeclared keys, so schema omission also needs
        // execution-time enforcement.
        throw new Error('run_in_background is disabled for this tool instance (enableRunInBackground: false)')
      }
      const resolvedCwd = resolveTargetCwd(args.cwd, parent.session.header.cwd)
      const request: AtStartRequest = {
        label: args.description,
        prompt: [{ type: 'text', text: args.prompt }] as ContentBlock[],
        parent,
        signal: exec.signal,
        cwd: resolvedCwd,
      }
      if (backgroundEnabled && args.run_in_background === true) {
        // One-shot background child: job preflight finishes before the starter
        // can spawn, and the task-owned signal covers startup.
        const jobs = ctx.get('jobs')
        if (jobs === undefined) {
          throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
        }
        const id = jobs.start({
          kind: 'subagent',
          label: args.description,
          owner: parent,
          run: () => {
            const controller = new AbortController()
            const start = ctx.subagents.start(config.providerName, { ...request, signal: controller.signal })
            return {
              cancel: (reason?: string) => {
                controller.abort(reason ?? 'background subagent task killed')
              },
              done: settleStart(start, controller.signal),
              // No readOutput: the child session owns intermediate detail.
            }
          },
        })
        return { kind: 'background' as const, jobId: id }
      }
      const run = await ctx.subagents.start(config.providerName, request)
      return settleForegroundRun(run)
    },
  }))

  // Top-level routing guidance — the model-facing counterpart of the host
  // `tool-subagent` sections (order 116.5). 116.6 keeps this section ordered
  // after the host subagent family and before the next free tool-guidance slot
  // (coggit:overview at 117); reusing 116.5 would tie-break by registration
  // order, and this plugin is a later-loaded third-party bundle, so its
  // position would be non-deterministic across boots. Static text: the tool is
  // always registered by this plugin, so no runtime emptiness check is needed.
  ctx.systemPrompt.section({
    name: 'tool:subagent_at',
    order: 116.6,
    text: SYSTEM_PROMPT_TEXT,
  })
}
