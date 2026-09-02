/**
 * Post-hoc repair case: the move already happened (a.md → moved/guide.md,
 * worktree shows ` D a.md` + untracked new file, links still pointing at the
 * old path). The same md_rename pair must enter link-only mode — `status:
 * "repaired"`, no move, in-links rewritten, out-link rebased — proving the
 * accepted already-happened-rename entry (20260831-posthoc-repair-mode).
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
import { mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

export default {
  id: 'md-rename-mock-posthoc-repaired',
  mode: 'mock',
  task: 'eval driver: scripted md_rename repairs an already-happened rename',
  async prepare(workspace) {
    seedRepo(workspace, {
      'a.md': '# A\n\n[home](README.md)\n',
      'README.md': '[a](a.md)\n',
    })
    // The move happened outside the tool: tracked a.md gone, new file present.
    mkdirSync(join(workspace, 'moved'), { recursive: true })
    renameSync(join(workspace, 'a.md'), join(workspace, 'moved', 'guide.md'))
  },
  script: {
    steps: [
      toolCallStep('md_rename', { oldPath: 'a.md', newPath: 'moved/guide.md' }),
      textStep('Mock rename complete.'),
    ],
  },
  expect: [
    firstTool('md_rename'),
    toolCallArgs('md_rename', { oldPath: 'a.md', newPath: 'moved/guide.md' }),
    toolResultSucceeded('md_rename'),
    toolResultTextIncludes('md_rename', '"status": "repaired"'),
    finalTextIncludes('Mock rename complete.'),
  ],
  async inspect(workspace) {
    if (pathExists(workspace, 'a.md')) throw new Error('post-hoc repair must not recreate the old path')
    if (readText(workspace, 'README.md') !== '[a](moved/guide.md)\n') {
      throw new Error(`in-link not repaired: ${JSON.stringify(readText(workspace, 'README.md'))}`)
    }
    if (readText(workspace, 'moved/guide.md') !== '# A\n\n[home](../README.md)\n') {
      throw new Error(`out-link not rebased: ${JSON.stringify(readText(workspace, 'moved/guide.md'))}`)
    }
  },
}
