/**
 * Post-hoc refusal case (D1): oldPath missing + newPath present but git has
 * no evidence of a completed rename (the old path was never tracked) →
 * `status: "conflict"` with the remedy exits, worktree untouched. Proves the
 * "refuse, never guess" boundary of the post-hoc entry
 * (20260831-posthoc-repair-mode).
 */
import {
  firstTool,
  toolCallArgs,
  toolResultSucceeded,
  toolResultTextIncludes,
  finalTextIncludes,
  toolCallStep,
  textStep,
} from '../../../../../eval/src/index.mjs'
import { pathExists, readText, seedRepo } from '../_fixtures/seed-repo.mjs'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export default {
  id: 'md-rename-mock-posthoc-no-evidence',
  mode: 'mock',
  task: 'eval driver: scripted md_rename refuses an evidence-free post-hoc call',
  async prepare(workspace) {
    seedRepo(workspace, { 'README.md': '# R\n' })
    // An untracked directory is moved: git can witness nothing about the old
    // path, so the (old, new) pair must be refused with a remedy hint.
    mkdirSync(join(workspace, 'untracked'), { recursive: true })
    writeFileSync(join(workspace, 'untracked', 'u.md'), '# U\n')
    renameSync(join(workspace, 'untracked'), join(workspace, 'moved'))
  },
  script: {
    steps: [
      toolCallStep('md_rename', { oldPath: 'untracked', newPath: 'moved' }),
      textStep('Mock rename complete.'),
    ],
  },
  expect: [
    firstTool('md_rename'),
    toolCallArgs('md_rename', { oldPath: 'untracked', newPath: 'moved' }),
    toolResultSucceeded('md_rename'),
    toolResultTextIncludes('md_rename', '"status": "conflict"'),
    toolResultTextIncludes('md_rename', 'no evidence of a completed rename'),
    toolResultTextIncludes('md_rename', 'git log --follow'),
    toolResultTextIncludes('md_rename', 'git checkout HEAD'),
    finalTextIncludes('Mock rename complete.'),
  ],
  async inspect(workspace) {
    if (!pathExists(workspace, 'moved/u.md')) throw new Error('the already-moved file must stay put')
    if (readText(workspace, 'README.md') !== '# R\n') throw new Error('README was rewritten on refusal')
  },
}
