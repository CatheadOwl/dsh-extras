/**
 * One-off diagnostic (not a case): runs the mock injection-smoke case with
 * the control arm's rowConfig. Expected when rowConfig reaches the prompt
 * row: inspect throws "expected exactly 1 … got 0" (injection suppressed).
 * A passing smoke here means the overlay never reached the row config.
 */
import { runEvalCase } from '@catheadowl/dsh-eval'

import smoke from '../../mock/injection-smoke.eval.mjs'

const result = await runEvalCase(
  {
    ...smoke,
    id: 'rowconfig-diagnostic',
    rowConfig: {
      prompt: {
        providerTimeoutMs: 2000,
        totalTimeoutMs: 5000,
        renderBudgetChars: 4000,
        disabledProviders: ['breadcrumb-description-enricher'],
      },
    },
  },
  { profile: 'headless', cliPath: process.env.DSH_CLI, mode: 'mock' },
)
console.log('exitCode:', result.exitCode)
console.log('inspectError:', result.inspectError ?? '(none — injection STILL happened, rowConfig did not reach the row)')
console.log('runDir (kept):', result.runDir)
console.log('--- full stderr ---')
console.log(result.stderr)
