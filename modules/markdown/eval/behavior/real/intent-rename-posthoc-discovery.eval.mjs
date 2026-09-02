/**
 * Real intent case (post-hoc repair, discovered new path): the task names
 * the missing old path but NOT where it went — the agent must explore the
 * worktree, find moved/guide.md, infer the completed rename, and repair via
 * md_rename's post-hoc branch. Asserts the full (oldPath, newPath) pair —
 * the discovery payoff — plus the `repaired` status; final link state is
 * asserted via inspect. Longer timeout than the explicit case because
 * exploration precedes the call. Requires a credential; auto-skips
 * otherwise.
 */
import { toolCalled, toolCallArgs, toolResultTextIncludes } from '@catheadowl/dsh-eval'
import { pathExists, readText, seedRepo } from '../_fixtures/seed-repo.mjs'
import { mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

export default {
  id: 'md-rename-real-intent-posthoc-discovery',
  mode: 'real',
  timeoutMs: 300_000,
  task: 'docs/guide.md 不见了，仓库根下多了个 moved/ 目录；README 里的链接还指向旧位置。请查清 guide.md 去了哪里，并修复所有指向旧路径的链接（文件本身已经在正确位置，不要动它）。',
  async prepare(workspace) {
    seedRepo(workspace, {
      'docs/guide.md': '# Guide\n\n[home](../README.md)\n',
      'README.md': '[guide](docs/guide.md)\n',
    })
    // Same already-happened move, but the task never names the destination.
    // The destination sits one level deeper so the post-hoc branch must
    // rebase the moved file's own out-link (../README.md → ../../README.md)
    // — work a one-line hand edit of the in-link would silently miss.
    mkdirSync(join(workspace, 'moved', '2026'), { recursive: true })
    renameSync(join(workspace, 'docs', 'guide.md'), join(workspace, 'moved', '2026', 'guide.md'))
  },
  expect: [
    toolCalled('md_rename'),
    toolCallArgs('md_rename', { oldPath: 'docs/guide.md', newPath: 'moved/2026/guide.md' }),
    toolResultTextIncludes('md_rename', '"status": "repaired"'),
  ],
  async inspect(workspace) {
    if (pathExists(workspace, 'docs/guide.md')) throw new Error('the agent recreated the old path')
    if (readText(workspace, 'README.md') !== '[guide](moved/2026/guide.md)\n') {
      throw new Error(`in-link not repaired: ${JSON.stringify(readText(workspace, 'README.md'))}`)
    }
    if (readText(workspace, 'moved/2026/guide.md') !== '# Guide\n\n[home](../../README.md)\n') {
      throw new Error(`out-link not rebased: ${JSON.stringify(readText(workspace, 'moved/2026/guide.md'))}`)
    }
  },
}
