/**
 * Conflict ladder case (blocking): `newPath` already exists → the whole move is
 * refused with `status: "conflict"` and the worktree is left byte-exact.
 * Proves the "conflict → reject whole, never half-move" transaction boundary
 * (spec §5 + §3 validate-all).
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
import { pathExists, readText, seedRepo } from '../_fixtures/seed-repo.mjs'

export default {
  id: 'md-rename-mock-conflict-newpath-exists',
  mode: 'mock',
  task: 'eval driver: scripted md_rename refused on newPath-exists',
  async prepare(workspace) {
    seedRepo(workspace, { 'a.md': '# A\n', 'b.md': '# B\n' })
  },
  script: {
    steps: [
      toolCallStep('md_rename', { oldPath: 'a.md', newPath: 'b.md' }),
      textStep('Mock rename complete.'),
    ],
  },
  expect: [
    firstTool('md_rename'),
    toolCallArgs('md_rename', { oldPath: 'a.md', newPath: 'b.md' }),
    toolResultSucceeded('md_rename'),
    toolResultTextIncludes('md_rename', '"status": "conflict"'),
    toolResultTextIncludes('md_rename', 'already exists'),
    finalTextIncludes('Mock rename complete.'),
  ],
  async inspect(workspace) {
    // Worktree untouched: neither file moved, neither content rewritten.
    if (readText(workspace, 'a.md') !== '# A\n') throw new Error('a.md was mutated on conflict')
    if (readText(workspace, 'b.md') !== '# B\n') throw new Error('b.md was overwritten on conflict')
    if (!pathExists(workspace, 'a.md')) throw new Error('a.md vanished on conflict')
  },
}
