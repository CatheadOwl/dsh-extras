/**
 * Dirty tracking for the incremental shortcut (W2): classify per-turn tool
 * activity from durable `tool/call` events and decide whether the turn-end
 * scan can be skipped. Pure logic — no dsh or node imports.
 *
 * Fail-safe direction: unknown tools are opaque (forced full scan). A wrong
 * whitelist entry can only cost performance, never a missed violation.
 */

import type { GateChangeSet } from './types.js'

/** Tools whose calls never mutate files. Deliberately small; widen by evidence only. */
export const READONLY_TOOLS: readonly string[] = ['read', 'read_image', 'gates_run', 'ask_user_question']

/** Tools whose arguments carry the exact changed path (`file_path`). */
const PRECISE_WRITE_TOOLS: readonly string[] = ['write', 'edit']

export type ToolChangeClass = 'readonly' | 'precise' | 'opaque'

/** Change footprint accumulated since the last clean pass. */
export interface DirtSummary {
  /** Exact paths changed by precise write tools. */
  paths: Set<string>
  /** True when any opaque (possibly-writing) tool ran. */
  opaque: boolean
}

export function emptyDirt(): DirtSummary {
  return { paths: new Set(), opaque: false }
}

/** Project accumulated dirt into the gate-input change set (T6). */
export function toChangeSet(dirt: DirtSummary): GateChangeSet {
  return { paths: [...dirt.paths], opaque: dirt.opaque }
}

export function classifyToolName(name: string): ToolChangeClass {
  if (READONLY_TOOLS.includes(name)) return 'readonly'
  if (PRECISE_WRITE_TOOLS.includes(name)) return 'precise'
  return 'opaque'
}

/** Extract the changed path from one precise-write call; defensive JSON parse. */
export function extractChangedPath(name: string, argsRaw: string | undefined): string | undefined {
  if (!PRECISE_WRITE_TOOLS.includes(name) || argsRaw === undefined) return undefined
  try {
    const args = JSON.parse(argsRaw) as { file_path?: unknown }
    return typeof args.file_path === 'string' && args.file_path !== '' ? args.file_path : undefined
  }
  catch {
    return undefined
  }
}

export interface ToolCallLike {
  name: string
  arguments?: string
}

/** Fold one tool call into the dirt summary; unparseable precise calls degrade to opaque. */
export function accumulateDirt(dirt: DirtSummary, call: ToolCallLike): void {
  const classification = classifyToolName(call.name)
  if (classification === 'readonly') return
  if (classification === 'precise') {
    const path = extractChangedPath(call.name, call.arguments)
    if (path !== undefined) {
      dirt.paths.add(path)
      return
    }
  }
  dirt.opaque = true
}

/** Minimal durable-event shape consumed here (`tool/call` payload). */
export interface SessionEventLike {
  type: string
  data?: { name?: string; arguments?: string }
}

/**
 * Scan append-only session events from `startIndex`, folding `tool/call`
 * activity into `dirt`. Returns the next start index. Callers reset their
 * state to a full scan when the log shrank below their stored index
 * (defense against any unexpected log mutation).
 */
export function collectDirtFromEvents(events: readonly SessionEventLike[], startIndex: number, dirt: DirtSummary): number {
  let index = startIndex
  for (; index < events.length; index++) {
    const event = events[index]
    if (event !== undefined && event.type === 'tool/call' && event.data !== undefined) {
      accumulateDirt(dirt, { name: event.data.name ?? '', arguments: event.data.arguments })
    }
  }
  return index
}

/** Turn-level decision: run everything, or shortcut the whole turn. */
export type TurnDecision =
  | { kind: 'full'; reason: 'first' | 'opaque' | 'dirty' }
  | { kind: 'shortcut' }

/**
 * Shortcut requires a previous clean pass AND a clean window since it.
 * First turn is always full (external-edit fallback); opaque dirt forces a
 * full scan; precise dirt keeps the turn full but allows per-gate skips.
 */
export function decideTurn(dirt: DirtSummary, hasPassedBefore: boolean): TurnDecision {
  if (!hasPassedBefore) return { kind: 'full', reason: 'first' }
  if (dirt.opaque) return { kind: 'full', reason: 'opaque' }
  if (dirt.paths.size > 0) return { kind: 'full', reason: 'dirty' }
  return { kind: 'shortcut' }
}

/**
 * Per-gate skip check inside a `dirty` turn: a gate declaring a relevance
 * matcher can reuse its last passed result when no dirty path concerns it.
 * Gates without a matcher always rescan.
 */
export function gateNeedsRescan(relevantPath: ((path: string) => boolean) | undefined, dirtPaths: Set<string>): boolean {
  if (relevantPath === undefined) return true
  if (dirtPaths.size === 0) return true
  for (const path of dirtPaths) {
    if (relevantPath(path)) return true
  }
  return false
}

/**
 * Compile declarative `relevant` patterns (gates.yml dialect) into a matcher.
 * MVP grammar: `*.ext` suffix match; any other pattern is a substring match
 * on the slash-normalized path.
 */
export function compileRelevantPatterns(patterns: readonly string[]): (path: string) => boolean {
  const normalized = patterns.map(pattern => pattern.replace(/\\/g, '/'))
  return (path: string): boolean => {
    const subject = path.replace(/\\/g, '/')
    return normalized.some((pattern) => {
      if (pattern.startsWith('*.')) return subject.endsWith(pattern.slice(1))
      return subject.includes(pattern)
    })
  }
}
