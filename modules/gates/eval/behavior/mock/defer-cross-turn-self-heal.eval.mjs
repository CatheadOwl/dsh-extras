/**
 * Cross-turn defer-self-heal case (FR: workunits/eval/TODO/20260902-cross-turn-async-repair-driver):
 * the full fire-and-forget loop — turn-close dispatch, child survival across
 * the settle wait, followup-driven re-scan turn, one dispatch per turn, and
 * the depth cap gracefully refusing grandchildren — asserted end to end
 * through the real headless CLI with the eval multi-turn driver.
 *
 * The workspace declares an always-failing defer-level command gate with a
 * subagent fixer. Script steps are the WHOLE-run orchestration (the mock
 * adapter's single cursor is shared across turns and sessions):
 * turn 1 answer → fixer#1 answer → turn 2 answer → fixer#2 answer.
 *
 * What each step proves:
 * - fixer#1 completed  ⇒ the child SURVIVED the turn boundary (the one-shot
 *   headless runner aborts exactly here; only the driver's settle wait and
 *   longer process lifetime make this pass);
 * - fixer#2 completed ⇒ the LAST turn's close-dispatched child also ran to
 *   completion (the driver's post-turn settle wait);
 * - dispatch count 2  ⇒ the bounded rhythm "one dispatch per failed stop,
 *   no more" across both turns.
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  finalTextMatches,
  subagentCompletedCount,
  subagentDispatchCount,
  textStep,
  userMessageTextIncludes,
} from '@catheadowl/dsh-eval'

export default {
  id: 'gates-mock-defer-cross-turn-self-heal',
  mode: 'mock',
  // Gate-interaction case: the package config disables the gates row by
  // default; an explicit empty list re-enables it (same as attribution-filter).
  disableRows: [],
  task: 'eval driver: finish turn 1 — the defer gate must dispatch a fixer child at turn close',
  followups: ['rescan now'],
  settleTimeoutMs: 60_000,
  async prepare(workspace) {
    spawnSync('git', ['init', '-q', workspace], { stdio: 'ignore' })
    writeFileSync(join(workspace, 'always-fail.txt'), 'x\n')
    writeFileSync(join(workspace, 'gates.yml'), [
      'gates:',
      '  - id: probe-defer',
      '    command: node -e "process.exit(1)"',
      '    description: always fails so the defer fixer always dispatches',
      '    rationale: cross-turn defer self-heal coverage',
      '    level: defer',
      '    fixer:',
      '      kind: subagent',
      '      prompt: fix the always-fail probe violation',
      '',
    ].join('\n'))
    spawnSync('git', ['-C', workspace, 'add', '-A'], { stdio: 'ignore' })
  },
  script: {
    steps: [
      textStep('turn 1 done'), // turn 1 stops → close dispatches fixer#1
      textStep('fixer 1 answer'), // fixer#1's model call (settle wait covers it)
      textStep('turn 2 done'), // followup turn stops → close dispatches fixer#2
      textStep('fixer 2 answer'), // fixer#2's model call (post-turn settle wait)
    ],
  },
  expect: [
    // The followup actually drove a second turn (the task prompt alone must
    // not satisfy this — scope to user-sourced messages carrying the text).
    userMessageTextIncludes(source => source?.kind === 'user', 'rescan now'),
    // Cursor anchor: turn 2's model call got its OWN step. If the settle
    // waits were removed and the shared cursor misaligned, the main session's
    // final text would be a fixer line instead.
    finalTextMatches(/^turn 2 done$/),
    // EVERY dispatched fixer ran to an answer — survival across the turn
    // boundary AND past the last turn's close. Count (not `.some`): a child
    // truncated at exit keeps its log and label, so only pinning each
    // outcome makes "dispatched ⇒ observable outcome" fail loudly.
    subagentCompletedCount(/^gates:fix:probe-defer$/, 2),
    // Bounded redispatch rhythm: one dispatch per failed stop, exactly.
    subagentDispatchCount(/^gates:fix:probe-defer$/, 2),
  ],
}
