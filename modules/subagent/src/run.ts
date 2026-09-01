/**
 * Fresh-process driver for one directory-targeted child runtime. Adapted
 * from the host's `@deepseek-ai/dsh-subagent-dsh-sdk` run driver (`run.ts`
 * is not in that package's published exports, so the ~90 lines of glue are
 * mirrored here): spawn over the SDK client's public launch face, race the
 * handshake against cancellation, fold `session.event` notifications into
 * the final output, settle the result under the seam's never-reject
 * contract, and tear the child down through the bounded shutdown ladder.
 *
 * @module @catheadowl/dsh-subagent-at/run
 */

import { randomUUID } from 'node:crypto'
import { DeepSeekHarness, type HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent, type TurnEndReason } from '@deepseek-ai/dsh-session'
import type { SubagentResult, SubagentRun, SubagentStartRequest, SubagentStopReason } from '@deepseek-ai/dsh-subagent'
import { AssistantOutputFold, settleRunResult, subprocessRunHandle } from '@deepseek-ai/dsh-subagent'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

/** Resolved spawn spec for one directory-targeted child runtime run. */
export interface AtRunSpec {
  /** Explicit dsh CLI module; omitted resolves the SDK client's same-version dependency. */
  dshBin?: string
  /** Named child profile serving the SDK protocol. */
  profile: string
  /** Ordered per-launch profile patch files (the child's composition). */
  patches: string[]
  /** Explicit isolated Harness home for the child; omitted uses the default. */
  dshHome?: string
  /**
   * Absolute per-call target directory: the child process cwd AND the
   * workspace cwd of its SDK session (validated by the provider beforehand).
   */
  cwd: string
  /** Provider route the child runtime initializes with. */
  provider: string
  /** Model the child runtime initializes with. */
  model: string
  /** Extra environment variables added on top of the scrubbed parent env. */
  env: Record<string, string>
  /** Bound (ms) on the protocol `shutdown` exchange during dispose. */
  shutdownTimeoutMs: number
  /** Grace period (ms) for the child's EOF-driven quiesce on dispose. */
  disposeEofGraceMs: number
  /** Termination confirmation window (ms), including forced exit. */
  disposeGraceMs: number
  /**
   * Sink for a child-level failure the run flattened into a stop reason
   * (the seam contract forbids `result` rejecting). A throw from the sink
   * itself is contained.
   */
  onError?: (error: Error, stopReason: SubagentStopReason) => void
}

/**
 * Map a child turn-end reason to a harness {@link SubagentStopReason}.
 * An absent or unknown reason maps to `error`, so an unclean stop is never
 * reported as `completed`.
 */
export function atStopReason(reason: TurnEndReason | undefined): SubagentStopReason {
  switch (reason?.kind) {
    case 'completed':
      return 'completed'
    case 'max-tokens':
      return 'max-tokens'
    case 'aborted':
      return 'aborted'
    default:
      return 'error'
  }
}

/** Normalize an unknown thrown value to an Error (the catch binding is `unknown`). */
function toError(value: unknown): Error {
  /* v8 ignore next */
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * Start and publish one child runtime run in the target directory after its
 * `initialize` handshake. Child failures settle through the run result;
 * startup failures reject after process reap. Disposal shuts the runtime
 * down and reaps it.
 * @param request - the start request; its signal is the cancellation channel.
 * @param spec - the resolved spawn spec (per-call cwd, child route, env, timeouts).
 * @returns the ready run handle for the child subprocess.
 */
export async function startAtRun(request: SubagentStartRequest, spec: AtRunSpec): Promise<SubagentRun> {
  if (request.signal.aborted) throw new Error('subagent-at: request was aborted before the child started')
  // The run id lives in the parent namespace; the child runtime's session id
  // (minted below, private to the wire) exists only inside the child process.
  const id = SessionId(randomUUID())

  const harness = new DeepSeekHarness({
    dshBin: spec.dshBin,
    profile: spec.profile,
    patches: spec.patches,
    dshHome: spec.dshHome,
    processCwd: spec.cwd,
    cwd: spec.cwd,
    env: { ...scrubbedParentEnv(), ...spec.env },
    shutdownTimeoutMs: spec.shutdownTimeoutMs,
    disposeEofGraceMs: spec.disposeEofGraceMs,
    disposeGraceMs: spec.disposeGraceMs,
    provider: spec.provider,
    model: spec.model,
  })

  // Cancellation settles the result without waiting for a cooperative child.
  const flags = { cancelled: false }
  let signalCancelSettled!: () => void
  const cancelSettled = new Promise<void>((resolve) => { signalCancelSettled = resolve })
  const requestCancel = (): void => {
    if (flags.cancelled) return
    flags.cancelled = true
    signalCancelSettled()
  }
  const onAbort = (): void => { requestCancel() }
  request.signal.addEventListener('abort', onAbort, { once: true })

  // Establish the child handshake before publishing a handle. Any failure
  // owns the still-private process and reaps it before rejecting.
  try {
    await Promise.race([
      harness.start(),
      cancelSettled.then((): never => { throw new Error('subagent-at: cancelled before the child initialized') }),
    ])
    if (flags.cancelled) throw new Error('subagent-at: cancelled before the child initialized')
  } catch (error: unknown) {
    request.signal.removeEventListener('abort', onAbort)
    await harness.close()
    if (flags.cancelled) throw new Error('subagent-at: request was aborted before the child started')
    throw toError(error)
  }

  const childSessionId = `session-${randomUUID().replaceAll('-', '')}`
  // The child's final answer under the seam's canonical selection rule
  // (`AssistantOutputFold`); a partial answer survives cancel and error paths.
  const fold = new AssistantOutputFold()
  const observe = (notification: HarnessNotification): void => {
    if (notification.method !== 'session.event' || notification.params.sessionId !== childSessionId) return
    fold.push(notification.params.event as SessionEvent)
  }
  const collectOutput = (): ContentBlock[] => fold.collect() ?? []

  // Race the child turn against local cancellation; the shared settlement
  // flattens failures under the seam's never-reject contract.
  const result: Promise<SubagentResult> = settleRunResult({
    attempt: async () => {
      const turn = await Promise.race([
        harness.session(childSessionId).run(request.prompt, { onNotification: observe }),
        cancelSettled.then(() => 'cancelled' as const),
      ])
      if (turn === 'cancelled') return { output: collectOutput(), stopReason: 'aborted' }
      const lastEnd = turn.events.findLast(
        (event): event is Extract<SessionEvent, { type: 'turn/end' }> => event.type === 'turn/end',
      )
      return { output: collectOutput(), stopReason: atStopReason(lastEnd?.data.reason) }
    },
    collectOutput,
    cancelled: () => flags.cancelled,
    onError: spec.onError,
    signal: request.signal,
    onAbort,
  })

  // There is no wire-level prompt cancel: dispose settles the result locally,
  // then the bounded shutdown request + dispose ladder tears the child down.
  return subprocessRunHandle({
    id,
    result,
    signal: request.signal,
    onAbort,
    requestCancel,
    teardown: () => harness.close(),
  })
}
