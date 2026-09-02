/**
 * Hard-import registration face for plugin-owned gates. Consumers
 * `import { registerGate } from '@catheadowl/dsh-extras/gates/register'` and call it
 * in `apply(ctx)` instead of hand-writing structural `*Like` mirrors plus
 * `ctx.inject(['gates'], …)`. The gate routes into the same `ctx.gates`
 * registry as the seam face, so it still joins `/gates` + `gates_run`
 * aggregation, the W2 dirty/incremental shortcut, and the block budget.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the `ctx.gates` Context augmentation from the service module.
import type {} from './service.js'

import type { GateDefinition } from './types.js'

export type {
  GateChangeSet,
  GateDefinition,
  GateFixer,
  GateFixerCommand,
  GateFixerSubagent,
  GateFixerSubagentRequest,
  GateLevel,
  GateRemedy,
  GateRemedyManual,
  GateRemedyOperation,
  GateResult,
  GateStatus,
  GateTrigger,
  GateViolation,
} from './types.js'

/**
 * Register one plugin-owned gate through the gates registry. The gate's
 * disposer runs when the owning fiber unloads or the gates service disappears
 * — the same lifecycle as the seam face.
 * @param ctx - the consumer plugin's context.
 * @param definition - the gate to register.
 */
export function registerGate(ctx: Context, definition: GateDefinition): void {
  ctx.inject(['gates'], (gatesCtx) => {
    return gatesCtx.gates.register(definition)
  })
}
