/**
 * Real intent case (evidence-free refusal): a move that DID happen but git
 * can witness nothing about — the directory was never tracked, so the old
 * path left no trace. The task is worded exactly like the passing repair
 * case, pinning that identical-looking requests route to the same
 * (oldPath, newPath) pair while the tool — not the agent — decides by git
 * evidence: repair there, refuse + remedy here. inspect guards that the
 * refusal leaves the already-moved content put and fabricates nothing.
 * Requires a credential; auto-skips otherwise.
 */
import { toolCalled, toolCallArgs, toolResultTextIncludes } from '../../../../../eval/src/index.mjs'
import { pathExists, readText, seedRepo } from '../_fixtures/seed-repo.mjs'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export default {
  id: 'md-rename-real-intent-no-evidence',
  mode: 'real',
  task: '我刚刚把 untracked/ 目录移动到了 moved/（文件已经在新位置），但仓库里的链接还指向旧路径。请修复这些链接；不要移动、复制或重新创建任何文件。',
  async prepare(workspace) {
    seedRepo(workspace, {
      'README.md': '# Repo\n\n[notes](notes.md)\n',
      'notes.md': '# Notes\n',
    })
    // The moved directory was never tracked: git can witness nothing about
    // the old path, so the (old, new) pair must be refused with a remedy.
    mkdirSync(join(workspace, 'untracked'), { recursive: true })
    writeFileSync(join(workspace, 'untracked', 'u.md'), '# U\n')
    renameSync(join(workspace, 'untracked'), join(workspace, 'moved'))
  },
  expect: [
    toolCalled('md_rename'),
    toolCallArgs('md_rename', { oldPath: 'untracked', newPath: 'moved' }),
    toolResultTextIncludes('md_rename', 'no evidence of a completed rename'),
  ],
  async inspect(workspace) {
    if (pathExists(workspace, 'untracked')) throw new Error('the agent recreated the old path')
    if (readText(workspace, 'moved/u.md') !== '# U\n') throw new Error('the already-moved file was rewritten')
    if (readText(workspace, 'README.md') !== '# Repo\n\n[notes](notes.md)\n') {
      throw new Error(`README was rewritten on refusal: ${JSON.stringify(readText(workspace, 'README.md'))}`)
    }
  },
}
