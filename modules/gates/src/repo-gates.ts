/**
 * Declarative gate materialization and project-file discovery.
 * Node-dependent (dynamic import / shell spawn / fs / yaml), so core.ts stays pure.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import YAML from 'yaml'

import { validateGateDefinition } from './core.js'
import { compileRelevantPatterns } from './dirty.js'
import type { ConfigGateEntry } from './types.js'
import type { GateChangeSet, GateDefinition, GateViolation } from './types.js'

/** Command-output cap so one chatty gate cannot flood the steer text. */
const OUTPUT_CAP = 4000

/** Default hard cap for one config-gate run; hung checks must not hold turn-stop hostage. */
const DEFAULT_GATE_TIMEOUT_MS = 120_000

/** Module exports accepted as an in-process gate surface. */
interface ModuleGateSurface {
  /** Generic shape: check(root, changes?) => violations. */
  check?: (root: string, changes?: GateChangeSet) => Promise<GateViolation[]> | GateViolation[]
}

function moduleGate(entry: ConfigGateEntry): GateDefinition {
  const moduleSpec = entry.module as string
  return {
    id: entry.id,
    description: entry.description ?? `repo-declared module gate ${entry.id}`,
    rationale: entry.rationale ?? `Repo-declared check ${entry.id}; see its violations for repair hints.`,
    on: ['stop', 'manual'],
    level: entry.level ?? 'blocking',
    timeoutMs: entry.timeoutMs ?? DEFAULT_GATE_TIMEOUT_MS,
    ...entry.relevant !== undefined ? { relevantPath: compileRelevantPatterns(entry.relevant) } : {},
    ...entry.fixer !== undefined ? { fixer: entry.fixer } : {},
    async check(root, changes: GateChangeSet | undefined) {
      const modulePath = isAbsolute(moduleSpec) ? moduleSpec : resolve(root, moduleSpec)
      if (!existsSync(modulePath)) {
        return [{ reason: `gate module not found: ${modulePath}` }]
      }
      const surface = await import(pathToFileURL(modulePath).href) as ModuleGateSurface
      if (typeof surface.check === 'function') {
        return [...await surface.check(root, changes)]
      }
      return [{ reason: `gate module ${JSON.stringify(moduleSpec)} exports no recognizable check surface (check)` }]
    },
  }
}

/**
 * Run a shell command with `root` as cwd and a hard timeout; stdout+stderr are
 * capped at `OUTPUT_CAP`. A hung command is killed (`timedOut: true`); a normal
 * exit carries its code; an async spawn `error` resolves `exitCode: null`. A
 * synchronous spawn throw (e.g. EPERM) rejects the returned promise — callers
 * that must never throw wrap the call. Shared by command gates (check) and
 * command fixers (repair).
 */
export function runCommand(command: string, root: string, timeoutMs: number, changes: GateChangeSet | undefined): Promise<{ exitCode: number | null; output: string; timedOut: boolean }> {
  return new Promise((resolveRun) => {
    const env = changes === undefined ? process.env : { ...process.env, GATE_CHANGES: JSON.stringify(changes) }
    const child = spawn(command, { cwd: root, shell: true, stdio: ['ignore', 'pipe', 'pipe'], env })
    let output = ''
    let settled = false
    let timedOut = false
    const collect = (chunk: Buffer): void => {
      if (output.length < OUTPUT_CAP) output += chunk.toString('utf8')
    }
    const settle = (result: { exitCode: number | null; output: string; timedOut: boolean }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveRun(result)
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    timer.unref?.()
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('error', () => settle({ exitCode: null, output: output || 'failed to start command', timedOut }))
    child.on('close', exitCode => settle({ exitCode, output, timedOut }))
  })
}

function commandGate(entry: ConfigGateEntry): GateDefinition {
  const command = entry.command as string
  const timeoutMs = entry.timeoutMs ?? DEFAULT_GATE_TIMEOUT_MS
  return {
    id: entry.id,
    description: entry.description ?? `repo-declared command gate ${entry.id}`,
    rationale: entry.rationale ?? `Repo-declared check ${entry.id}; a nonzero command exit means the check failed.`,
    on: ['stop', 'manual'],
    level: entry.level ?? 'blocking',
    timeoutMs,
    ...entry.relevant !== undefined ? { relevantPath: compileRelevantPatterns(entry.relevant) } : {},
    ...entry.fixer !== undefined ? { fixer: entry.fixer } : {},
    async check(root, changes) {
      const { exitCode, output, timedOut } = await runCommand(command, root, timeoutMs, changes)
      if (timedOut) {
        return [{
          reason: `command ${JSON.stringify(command)} timed out after ${timeoutMs}ms`,
          remedy: {
            kind: 'manual',
            guidance: 'The gate command hangs; run it manually in a terminal to find where it blocks, or raise the gate timeoutMs if it is simply slow.',
          },
        }]
      }
      if (exitCode === 0) return []
      const trimmed = output.trim()
      return [{
        reason: `command ${JSON.stringify(command)} exited ${String(exitCode)}${trimmed === '' ? '' : `:\n${trimmed.slice(0, OUTPUT_CAP)}`}`,
        remedy: {
          kind: 'manual',
          guidance: 'Read the command output above and repair the reported problems at their locations.',
        },
      }]
    },
  }
}

/**
 * One declarative entry becomes one gate; entries declaring neither surface
 * fail loud, and every materialized definition passes the same vocabulary
 * validation as plugin-registered ones (a typo'd level must not silently
 * demote a gate to never-blocking).
 */
export function materializeGates(entries: readonly ConfigGateEntry[]): GateDefinition[] {
  const seen = new Set<string>()
  return entries.map((entry) => {
    let definition: GateDefinition
    if (entry.module !== undefined) definition = moduleGate(entry)
    else if (entry.command !== undefined) definition = commandGate(entry)
    else throw new Error(`gate ${JSON.stringify(entry.id)} declares neither module nor command`)
    validateGateDefinition(definition)
    if (seen.has(definition.id)) {
      throw new Error(`gate ${JSON.stringify(definition.id)} is declared more than once in ${PROJECT_GATES_FILE}`)
    }
    seen.add(definition.id)
    return definition
  })
}

/**
 * Project-owned gate declaration file. The file belongs to the project
 * (like hooks.json belongs to a CC project); the gates plugin is only the
 * executor. Discovered per run from the session workspace root, so checks
 * never leak across workspaces.
 */
export const PROJECT_GATES_FILE = 'gates.yml'

export interface ProjectGatesLoadResult {
  definitions: GateDefinition[]
  /** Present when the file exists but yields no gates (parse/shape/materialize failure). */
  error?: string
}

/** Parse one gates.yml document into declarative entries; malformed shapes fail loud. */
export function parseProjectGatesYaml(content: string): ConfigGateEntry[] {
  const doc: unknown = YAML.parse(content)
  if (doc === null || doc === undefined) return []
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error(`${PROJECT_GATES_FILE} must be a mapping with a 'gates' list`)
  }
  const gates = (doc as Record<string, unknown>).gates
  if (gates === undefined || gates === null) return []
  if (!Array.isArray(gates)) {
    throw new Error(`${PROJECT_GATES_FILE}: 'gates' must be a list`)
  }
  return gates.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`${PROJECT_GATES_FILE}: gates[${index}] must be a mapping`)
    }
    return entry as ConfigGateEntry
  })
}

/** Load one workspace's declared gates; an absent file means the project declares none. */
export function loadProjectGates(root: string): ProjectGatesLoadResult {
  const filePath = resolve(root, PROJECT_GATES_FILE)
  if (!existsSync(filePath)) return { definitions: [] }
  try {
    return { definitions: materializeGates(parseProjectGatesYaml(readFileSync(filePath, 'utf8'))) }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { definitions: [], error: message }
  }
}
