/** The `ctx.gates` registry service: registration surface for plugins, run surface for the driver entries, and repair surface for offline self-heal. */
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import z from '@deepseek-ai/schemastery'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'

import { collectDeferredFailures, createGateRegistry, excludeDisabledGates, runGates, selectGates } from './core.js'
import type { GateFailure, RunGatesOptions } from './core.js'
import { dispatchFixer } from './fixer.js'
import { loadProjectGates, PROJECT_GATES_FILE } from './repo-gates.js'
import type { GateDefinition, GateResult, GateTrigger } from './types.js'

export interface Config {
  /** Consecutive forced continuations before a blocking failure degrades to pass-through. */
  maxConsecutiveBlocks?: number
}

export const ConfigSchema: z<Config> = z.object({
  maxConsecutiveBlocks: z.number().default(3),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    gates: GatesService
  }
}

export interface RunOptions extends RunGatesOptions {
  /** Restrict to gates opting into one trigger; defaults to the manual dimension ('manual'). */
  trigger?: GateTrigger
  /** Restrict to one gate id (plugin-registered or project-declared); unknown ids fail loud. */
  gate?: string
}

/** What the repair surface needs to dispatch subagent fixers on a turn's behalf. */
export interface RepairOptions {
  /** The delegating parent (turn's agent) whose history the fork fixer seeds the child with. */
  agent: Agent
  /** Cancellation from the turn; absent → a fresh never-aborted signal, so the child outlives the caller. */
  signal?: AbortSignal
}

/** One-shot "check + offline self-heal": run gates, then repair deferred failures. */
export interface RunAndRepairOptions extends RunOptions, RepairOptions {}

/** A loadable gates.yml that fails to parse still gets a voice: one blocking gate reporting the error. */
function configErrorGate(error: string): GateDefinition {
  return {
    id: 'gates-config',
    description: 'Workspace gates.yml integrity',
    rationale:
      `${PROJECT_GATES_FILE} declares this project's quality gates; until it parses, none of the declared gates can run. `
      + 'Fixing the file restores every declared check.',
    on: ['stop', 'manual'],
    level: 'blocking',
    check: async () => [{
      file: PROJECT_GATES_FILE,
      reason: `${PROJECT_GATES_FILE} could not be loaded: ${error}`,
      remedy: {
        kind: 'manual',
        guidance: `Repair ${PROJECT_GATES_FILE} (a YAML mapping with a \`gates:\` list of id/module|command entries); the declared gates resume automatically.`,
      },
    }],
  }
}

export function mergeGateDefinitions(
  registry: readonly GateDefinition[],
  project: readonly GateDefinition[],
  overlays: ReadonlyMap<string, Record<string, unknown>> = new Map(),
): {
  definitions: GateDefinition[]
  error?: string
} {
  const byId = new Map<string, 'plugin' | 'project'>()
  for (const definition of registry) byId.set(definition.id, 'plugin')
  for (const definition of project) {
    const owner = byId.get(definition.id)
    if (owner !== undefined) {
      return {
        definitions: [...registry],
        error: `${PROJECT_GATES_FILE} declares gate ${JSON.stringify(definition.id)}, but that id is already registered by a ${owner} gate`,
      }
    }
    byId.set(definition.id, 'project')
  }
  const definitions = [...registry, ...project]
  // Options-only overlays: repo policy onto plugin-registered gates. The id
  // must resolve to a plugin gate (an overlay onto a project-declared gate is
  // a duplicate declaration — those options belong on the entry itself).
  for (const [id, overlay] of overlays) {
    const index = definitions.findIndex(definition => definition.id === id)
    if (index === -1) {
      return {
        definitions,
        error: `${PROJECT_GATES_FILE} declares an options overlay for gate ${JSON.stringify(id)}, but no plugin gate with that id is registered`,
      }
    }
    if (byId.get(id) !== 'plugin') {
      return {
        definitions,
        error: `${PROJECT_GATES_FILE} declares an options overlay for gate ${JSON.stringify(id)}, which is project-declared — put its options on that gate's own entry`,
      }
    }
    definitions[index] = { ...definitions[index], options: { ...definitions[index].options, ...overlay } }
  }
  return { definitions }
}

interface ProjectGatesCacheEntry {
  /** gates.yml mtime, or null when the file is absent; the cache key's freshness token. */
  mtimeMs: number | null
  definitions: GateDefinition[]
  overlays: Map<string, Record<string, unknown>>
  error?: string
}

/** `ctx.gates` — the gate registry plus the offline-repair surface: checks stay read-only, repair lives here. */
export class GatesService extends Service {
  static Config = ConfigSchema

  private readonly registry = createGateRegistry()

  /** Project-declared gates per workspace root, invalidated by gates.yml mtime. */
  private readonly projectCache = new Map<string, ProjectGatesCacheEntry>()

  /**
   * User-disabled gate ids per trigger, mirrored from the browser's
   * localStorage by the Settings → Plugins → Gates tab (the tab pushes the
   * persisted lists on load and on every switch). In-memory by design: the
   * browser owns persistence, the host only enforces. A gate's two dimensions
   * are independent — turn-stop (fixed, mandatory) and manual (agent-chosen) —
   * because a user may want a gate only at turn-stop, only on demand, or not
   * at all.
   */
  private disabled: { stop: Set<string>; manual: Set<string> } = {
    stop: new Set<string>(),
    manual: new Set<string>(),
  }

  constructor(ctx: Context, _config: Config) {
    super(ctx, 'gates')
  }

  /** Register one gate; the returned disposer unregisters it. Duplicate ids fail loud. */
  register(definition: GateDefinition): () => void {
    return this.registry.register(definition)
  }

  /** Plugin-registered gates only; project-declared gates join at run time (workspace-scoped). */
  list(): GateDefinition[] {
    return this.registry.list()
  }

  /** Gate ids the user switched off per trigger (empty until the browser pushes its stored lists). */
  disabledTriggers(): { stop: string[]; manual: string[] } {
    return { stop: [...this.disabled.stop], manual: [...this.disabled.manual] }
  }

  /** Replace the user-disabled id lists — the browser-owned state, mirrored for enforcement. */
  setDisabledTriggers(state: { stop: readonly string[]; manual: readonly string[] }): void {
    this.disabled = { stop: new Set(state.stop), manual: new Set(state.manual) }
  }

  /**
   * Registry + workspace `gates.yml` minus user-disabled ids, restricted to
   * one trigger — exactly what that trigger's path executes. A gate runs on a
   * trigger only if it opts in (`on`) AND the user left that dimension on.
   */
  runnableDefinitions(root: string, trigger: GateTrigger): GateDefinition[] {
    return excludeDisabledGates(
      selectGates(this.definitions(root), trigger),
      this.disabled[trigger],
    )
  }

  /**
   * Run selected gates serially against one workspace root. Definitions are
   * the union of plugin-registered gates and the root's own `gates.yml`.
   * Without a `trigger`, the manual dimension runs (the agent-chosen path);
   * an explicit single-gate run of a manual-disabled gate fails loud (the
   * switch is the contract — no silent override). The stop dimension is
   * enforced by the turn-stopping driver, which passes `trigger: 'stop'`.
   */
  async run(root: string, options: RunOptions = {}): Promise<GateResult[]> {
    const trigger = options.trigger ?? 'manual'
    if (options.gate !== undefined) {
      const definitions = this.definitions(root)
      const definition = definitions.find(candidate => candidate.id === options.gate)
      if (definition === undefined) {
        throw new Error(`gate ${JSON.stringify(options.gate)} is not registered`)
      }
      if (this.disabled.manual.has(definition.id)) {
        throw new Error(
          `gate ${JSON.stringify(options.gate)} is disabled for manual runs in the gates settings; `
          + 'enable its manual switch in Settings → Plugins → Gates before running it',
        )
      }
      return runGates([definition], root, { signal: options.signal, changes: options.changes })
    }
    return runGates(this.runnableDefinitions(root, trigger), root, {
      signal: options.signal,
      changes: options.changes,
    })
  }

  /**
   * Repair deferred failures off-turn: dispatch each failure's fixer (a
   * subagent or command). Never throws.
   */
  async repair(root: string, failures: readonly GateFailure[], options: RepairOptions): Promise<void> {
    const signal = options.signal ?? new AbortController().signal
    await dispatchFixer(this.ctx, failures, { agent: options.agent, signal, root })
  }

  /**
   * Run selected gates against one workspace root, then repair deferred
   * failures off-turn — the "check + offline self-heal" unit for consumers
   * other than the turn-stopping driver (which reuses `repair` directly).
   */
  async runAndRepair(root: string, options: RunAndRepairOptions): Promise<GateResult[]> {
    const results = await this.run(root, options)
    const deferred = collectDeferredFailures(this.definitions(root), results)
    await this.repair(root, deferred, options)
    return results
  }

  /** Registry gates + the workspace's gates.yml, with a parse-error gate when the file is broken. */
  definitions(root: string): GateDefinition[] {
    const project = this.projectGates(root)
    const merged = mergeGateDefinitions(this.registry.list(), project.definitions, project.overlays)
    const error = project.error ?? merged.error
    if (error === undefined) return merged.definitions
    return [...merged.definitions, configErrorGate(error)]
  }

  private projectGates(root: string): ProjectGatesCacheEntry {
    let mtimeMs: number | null
    try {
      mtimeMs = statSync(resolve(root, PROJECT_GATES_FILE)).mtimeMs
    }
    catch {
      mtimeMs = null
    }
    const cached = this.projectCache.get(root)
    if (cached !== undefined && cached.mtimeMs === mtimeMs) return cached
    const loaded = mtimeMs === null
      ? { definitions: [] as GateDefinition[], overlays: new Map<string, Record<string, unknown>>(), error: undefined }
      : loadProjectGates(root)
    const entry: ProjectGatesCacheEntry = { mtimeMs, definitions: loaded.definitions, overlays: loaded.overlays, error: loaded.error }
    this.projectCache.set(root, entry)
    return entry
  }
}
