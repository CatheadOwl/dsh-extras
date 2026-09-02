/**
 * Real intent case (post-hoc repair, explicit pair): the task hands over an
 * already-happened move (a.md → moved/guide.md) and asks only for link
 * repair. The intent surface under test: the agent must translate the
 * situation into the SAME md_rename pair — trusting the tool's post-hoc
 * branch — instead of moving files back, recreating the old path, or
 * hand-editing links. Tool selection, argument routing and the `repaired`
 * status are asserted; model wording and exploration-first ordering are
 * not. Requires a credential; auto-skips otherwise.
 */
import { toolCalled, toolCallArgs, toolResultTextIncludes } from '@catheadowl/dsh-eval'
import { pathExists, readText, seedRepo } from '../_fixtures/seed-repo.mjs'
import { mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

export default {
  id: 'md-rename-real-intent-posthoc-repair',
  mode: 'real',
  task: '我刚刚把 a.md 移动到了 moved/guide.md（文件已经在新位置），但仓库里的链接还指向旧路径。请修复这些链接；不要移动、复制或重新创建任何文件。',
  async prepare(workspace) {
    seedRepo(workspace, {
      'a.md': '# A\n\n[home](README.md)\n',
      'README.md': '[a](a.md)\n',
    })
    // The move happened outside the tool: tracked a.md gone, new file present.
    mkdirSync(join(workspace, 'moved'), { recursive: true })
    renameSync(join(workspace, 'a.md'), join(workspace, 'moved', 'guide.md'))
  },
  expect: [
    toolCalled('md_rename'),
    toolCallArgs('md_rename', { oldPath: 'a.md', newPath: 'moved/guide.md' }),
    toolResultTextIncludes('md_rename', '"status": "repaired"'),
  ],
  async inspect(workspace) {
    if (pathExists(workspace, 'a.md')) throw new Error('the agent recreated the old path')
    if (readText(workspace, 'README.md') !== '[a](moved/guide.md)\n') {
      throw new Error(`in-link not repaired: ${JSON.stringify(readText(workspace, 'README.md'))}`)
    }
    if (readText(workspace, 'moved/guide.md') !== '# A\n\n[home](../README.md)\n') {
      throw new Error(`out-link not rebased: ${JSON.stringify(readText(workspace, 'moved/guide.md'))}`)
    }
  },
}
