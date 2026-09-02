/**
 * Conflict ladder case (blocking): `oldPath` missing → refused with a
 * `does not exist` conflict. Proves the hard-precondition rejection branch.
 */
import {
  firstTool,
  toolCallArgs,
  toolResultSucceeded,
  toolResultTextIncludes,
  finalTextIncludes,
  toolCallStep,
  textStep,
} from '@catheadowl/dsh-eval'
import { pathExists, seedRepo } from '../_fixtures/seed-repo.mjs'

export default {
  id: 'md-rename-mock-conflict-oldpath-missing',
  mode: 'mock',
  task: 'eval driver: scripted md_rename refused on oldPath-missing',
  async prepare(workspace) {
    seedRepo(workspace, { 'a.md': '# A\n' })
  },
  script: {
    steps: [
      toolCallStep('md_rename', { oldPath: 'missing.md', newPath: 'b.md' }),
      textStep('Mock rename complete.'),
    ],
  },
  expect: [
    firstTool('md_rename'),
    toolCallArgs('md_rename', { oldPath: 'missing.md', newPath: 'b.md' }),
    toolResultSucceeded('md_rename'),
    toolResultTextIncludes('md_rename', '"status": "conflict"'),
    toolResultTextIncludes('md_rename', 'does not exist'),
    finalTextIncludes('Mock rename complete.'),
  ],
  async inspect(workspace) {
    if (pathExists(workspace, 'b.md')) throw new Error('b.md was created despite a missing old path')
  },
}
