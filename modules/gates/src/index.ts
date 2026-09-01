/**
 * gates: workspace quality gates for dsh (local CI for agent sessions).
 * Thin registration shell — service, repo-declared config gates, the
 * `gates_run` tool, the `/gates` command, and the `agent/turn-stopping`
 * blocking driver with its consecutive-block budget.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Type-only: pulls the `ctx.commands` Context augmentation; the registry
// service itself is provided by the host profile. No runtime import.
import type {} from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'

import {
  collectBlockingFailures,
  collectDeferredFailures,
  formatGateFailureFeedback,
  formatGateSummary,
  nextBlockBudget,
  runGates,
} from './core.js'
import {
  collectDirtFromEvents,
  decideTurn,
  emptyDirt,
  gateNeedsRescan,
  toChangeSet,
} from './dirty.js'
import type { DirtSummary, SessionEventLike } from './dirty.js'
import { GatesController } from './controller.js'
import { ConfigSchema, GatesService } from './service.js'
import type { Config as GatesConfig } from './service.js'
import { registerGatesConfigGuideSkill } from './skills.js'
import type { GateDefinition, GateResult } from './types.js'

export const name = 'gates'

export const inject = ['tools']

export const Config = ConfigSchema

const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'gates' }

const DEFAULT_MAX_CONSECUTIVE_BLOCKS = 3

/**
 * Resolve the self-provided `gates` service via `ctx.get` (global store).
 * The `ctx.gates` property proxy cannot reach it: the service registers on
 * this plugin's own child fiber, and the proxy walk is ancestor-only.
 */
function gatesService(ctx: Context): GatesService {
  return ctx.get('gates') as GatesService
}

function allPassed(results: readonly GateResult[]): boolean {
  return results.every(result => result.status === 'passed')
}

/**
 * 本地 JsonValue 别名：上游 `@deepseek-ai/dsh-tools` 自 9135a13a8b 起不再 re-export
 * `JsonValue`（只从 `@deepseek-ai/dsh-util-values` 内部导入）；结构与其保持一致，
 * 避免为单个类型引入新 peer 依赖。
 */
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** Lossless JSON projection for the json-schema tool output. */
function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function registerGatesTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'gates_run',
    description:
      'Run the workspace quality gates and return their aggregated results. Use it before declaring work complete: blocking gates also run automatically when the turn is about to close, and calling this first surfaces every violation with its location and remedy guidance in one pass. Pass a gate id to run a single gate.',
    parameters: {
      gate: {
        type: 'string',
        description: 'Optional registered gate id to run a single gate; omit to run all.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const root = exec.agent?.session.header.cwd ?? '.'
      const service = gatesService(ctx)
      const results = await service.run(root, args.gate === undefined
        ? { signal: exec.signal }
        : { gate: args.gate, signal: exec.signal })
      return toJsonValue({
        passed: allPassed(results),
        summary: formatGateSummary(results),
        results,
      })
    },
  }))
}

export async function apply(ctx: Context, config: GatesConfig): Promise<void> {
  await ctx.plugin(GatesService, config)
  const service = gatesService(ctx)

  // Settings → Plugins → Gates surface: the Typert remote for the flat gate
  // list + switches. The browser owns the switch list (localStorage) and the
  // tab mirrors it into host memory through `gates/setDisabled` on load and on
  // every switch — host enforcement reads the mirror.
  await ctx.plugin(GatesController, service)

  registerGatesTool(ctx)
  registerGatesConfigGuideSkill(ctx)

  // Human entry: dispatch without a model turn.
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'gates',
      description: 'Run workspace quality gates (local CI) and report the aggregate',
      input: { hint: '[<gate-id>]' },
      handler: async ({ agent, rawInput, signal }) => {
        const gate = rawInput.trim()
        const results = await service.run(agent.session.header.cwd ?? '.', gate === '' ? { signal } : { gate, signal })
        return {
          kind: allPassed(results) ? 'success' : 'error',
          text: formatGateSummary(results),
        }
      },
    })
  })

  // Blocking driver with the W2 incremental shortcut: per-(agent, root) dirty
  // state built from durable `tool/call` events decides whether the turn-end
  // scan can be skipped. Rules (user-confirmed): readonly whitelist
  // {read, read_image, gates_run, ask_user_question}, unknown tools opaque;
  // only a previous PASSED result is ever reused; first turn and manual
  // entries always scan full (external-edit fallback).
  interface TurnGateState {
    /** Next unprocessed index into the append-only session event log. */
    nextEventIndex: number
    dirt: DirtSummary
    /** True once one full turn-end pass came back clean. */
    hasPassed: boolean
    /** Last passed result per gate id, reusable on precise-only dirt turns. */
    passedResults: Map<string, GateResult>
    /** Consecutive forced continuations (budget). */
    blocks: number
  }
  const turnStates = new WeakMap<Agent, Map<string, TurnGateState>>()
  const maxBlocks = config.maxConsecutiveBlocks ?? DEFAULT_MAX_CONSECUTIVE_BLOCKS
  ctx.on('agent/turn-stopping', async ({ agent, signal }): Promise<void> => {
    const root = agent.session.header.cwd ?? '.'
    let byRoot = turnStates.get(agent)
    if (byRoot === undefined) {
      byRoot = new Map()
      turnStates.set(agent, byRoot)
    }
    let state = byRoot.get(root)
    if (state === undefined) {
      state = { nextEventIndex: 0, dirt: emptyDirt(), hasPassed: false, passedResults: new Map(), blocks: 0 }
      byRoot.set(root, state)
    }

    // 1) Incremental dirt scan over new durable events. A shrunken log
    // (unexpected mutation) resets the state into a fresh full scan.
    const events = agent.session.events as unknown as readonly SessionEventLike[]
    if (events.length < state.nextEventIndex) {
      state.nextEventIndex = 0
      state.dirt = emptyDirt()
      state.hasPassed = false
      state.passedResults = new Map()
    }
    state.nextEventIndex = collectDirtFromEvents(events, state.nextEventIndex, state.dirt)

    // 2) Turn decision: a clean window after a clean pass shortcuts everything.
    const decision = decideTurn(state.dirt, state.hasPassed)
    if (decision.kind === 'shortcut') {
      state.blocks = 0
      return
    }

    // 3) Gate selection; on precise-only dirt, gates whose relevance matcher
    // matches no dirty path reuse their last passed result. User-disabled
    // gates never enter this selection (per-trigger: the turn-stop dimension).
    const definitions = service.runnableDefinitions(root, 'stop')
    const toRun: GateDefinition[] = []
    const results: GateResult[] = []
    for (const definition of definitions) {
      const lastPassed = state.passedResults.get(definition.id)
      if (
        decision.kind === 'full' && decision.reason === 'dirty'
        && lastPassed !== undefined
        && !gateNeedsRescan(definition.relevantPath, state.dirt.paths)
      ) {
        results.push({ ...lastPassed, status: 'skipped' })
        continue
      }
      toRun.push(definition)
    }
    results.push(...await runGates(toRun, root, {
      signal,
      changes: toChangeSet(state.dirt),
    }))

    // 4) Blocking failures steer within the budget; deferred failures are
    // handed to their fixer instead of steering — the "旁路". A subagent fixer
    // dispatches a child off-turn; a command fixer runs synchronously here.
    // A clean pass — no blocking AND no deferred failures — resets the dirt
    // window and records reusable passed results; a deferred failure keeps the
    // window dirty so the gate re-runs until it passes.
    const failures = collectBlockingFailures(definitions, results)
    const deferred = collectDeferredFailures(definitions, results)

    await service.repair(root, deferred, { agent, signal })
    if (failures.length === 0) {
      state.blocks = 0
      if (deferred.length === 0) {
        state.dirt = emptyDirt()
        state.hasPassed = true
        state.passedResults = new Map(
          results.filter(result => result.status === 'passed').map(result => [result.gateId, result]),
        )
      }
      return
    }
    const budget = nextBlockBudget(state.blocks, true, maxBlocks)
    state.blocks = budget.count
    if (!budget.steer) {
      // Budget exhausted: keep the failure visible in the log, let the turn close.
      console.warn(`gates: consecutive-block budget (${maxBlocks}) exhausted; passing with failing gate(s): ${failures.map(failure => failure.definition.id).join(', ')}`)
      return
    }
    agent.steer(createUserMessage({
      content: [{ type: 'text', text: formatGateFailureFeedback(failures) }],
      source: PLUGIN_SOURCE,
    }))
  })
}
