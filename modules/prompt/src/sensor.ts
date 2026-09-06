/**
 * Tool-touch sensor bookkeeping: closed-set extraction, ancestor up-float,
 * and pending-set semantics for the touch signal lane. Pure state and
 * computation only — no I/O, no injection; the driver records what settles
 * at the root execution and the runner holds the per-session pending set
 * consumed at the next pre-step.
 */

/** Opaque correlation identity shared between an execution and its nested children. */
export type TouchToken = symbol

/** Session slice the sensor reads at the root settle. */
export interface TouchAgent {
  readonly session: {
    readonly id: string
    readonly header: { readonly cwd?: string }
  }
}

/** Structural slice of a settled `ToolExecution` the sensor reads. */
export interface TouchExecution {
  readonly name: string
  readonly arguments: unknown
  readonly token: TouchToken
  readonly parent?: TouchToken
  readonly agent?: TouchAgent
  readonly signal: { readonly aborted: boolean }
}

/** One admitted file touch, normalized into the project-relative key space. */
export interface RecordedTouch {
  readonly path: string
  readonly tool: string
}

const TOUCH_TOOL_NAMES = new Set(['read', 'edit'])

/**
 * Closed-set extraction aligned with the host's `filePathFromExecution`:
 * only `read`/`edit` carry a `file_path` argument the sensor admits.
 * `write` stays deferred (new-file semantics unset).
 */
export function touchPathFromExecution(exec: Pick<TouchExecution, 'name' | 'arguments'>): string | undefined {
  if (!TOUCH_TOOL_NAMES.has(exec.name)) return undefined
  if (typeof exec.arguments !== 'object' || exec.arguments === null) return undefined
  if (!('file_path' in exec.arguments) || typeof exec.arguments.file_path !== 'string') return undefined
  const filePath = exec.arguments.file_path.trim()
  return filePath.length > 0 ? filePath : undefined
}

/**
 * Canonicalize a touched path into the same key space the prompt side uses:
 * forward slashes, no trailing slash, and project-relative when it sits under
 * the session's working directory. Paths outside the project stay absolute —
 * providers without a pairing there resolve to nothing anyway.
 */
export function normalizeTouchPath(filePath: string, cwd: string): string {
  let path = filePath.replace(/\\/g, '/')
  path = path.replace(/\/+$/u, '')
  const cwdCanonical = cwd.replace(/\\/g, '/').replace(/\/+$/u, '')
  const prefix = `${cwdCanonical}/`
  if (cwdCanonical !== '' && (path.startsWith(prefix) || windowsDriveStartsWith(path, prefix))) {
    path = path.slice(prefix.length)
  }
  return path
}

/**
 * Windows drive-letter prefixes compare case-insensitively: `d:\Proj` and
 * `D:\proj` name the same directory, and a mismatch would leave the touch
 * keyed absolutely while the prompt side keys project-relatively — breaking
 * the cross-source once key space.
 */
function windowsDriveStartsWith(path: string, prefix: string): boolean {
  if (!/^[a-zA-Z]:\//u.test(path) || !/^[a-zA-Z]:\//u.test(prefix)) return false
  return path.toLowerCase().startsWith(prefix.toLowerCase())
}

/**
 * Ancestor up-float: touches observed on nested executions accumulate on the
 * enclosing execution's token and settle only at the root — one nested call
 * is consumed exactly once, on the execution that owns the full ancestor
 * context. Mirrors the host's `executionTouches` token-chain precedent.
 */
export class TouchFloatQueue {
  private readonly byToken = new Map<TouchToken, RecordedTouch[]>()

  dispose(): void {
    this.byToken.clear()
  }

  /**
   * Settle one `tools/result`. Admits the execution's own touch only when the
   * result is successful, agent-owned, and not aborted; floats everything to
   * the parent token when one exists. Returns the touches this root
   * execution owns (already normalized against `cwd`), empty when floated.
   * Touches reaching an agent-less root are returned all the same — the
   * caller owns dropping them, since no session can own the recording.
   */
  settle(exec: TouchExecution, isError: boolean, cwd: string): RecordedTouch[] {
    const touches = this.byToken.get(exec.token) ?? []
    this.byToken.delete(exec.token)
    if (!isError && exec.agent !== undefined && !exec.signal.aborted) {
      const raw = touchPathFromExecution(exec)
      if (raw !== undefined) touches.push({ path: normalizeTouchPath(raw, cwd), tool: exec.name })
    }
    if (exec.parent !== undefined) {
      const parentTouches = this.byToken.get(exec.parent)
      if (parentTouches === undefined) this.byToken.set(exec.parent, touches)
      else parentTouches.push(...touches)
      return []
    }
    return touches
  }
}
