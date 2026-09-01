/**
 * Directory move case: moving a whole subtree rewrites external in-links that
 * point INTO it, while internal subtree links (same-depth `../`) stay valid
 * unchanged. Proves the subtree-consistency branch of the deterministic layer.
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

export default {
  id: 'md-rename-mock-directory-subtree',
  mode: 'mock',
  task: 'eval driver: scripted md_rename directory move (subtree consistency)',
  async prepare(workspace) {
    seedRepo(workspace, {
      'README.md': '[a](docs/a.md)\n[sub](docs/sub/b.md)\n',
      'docs/a.md': '# A\n\n[back](../README.md)\n',
      'docs/sub/b.md': '# B\n\n[up](../a.md)\n',
    })
  },
  script: {
    steps: [
      toolCallStep('md_rename', { oldPath: 'docs', newPath: 'notes' }),
      textStep('Mock rename complete.'),
    ],
  },
  expect: [
    firstTool('md_rename'),
    toolCallArgs('md_rename', { oldPath: 'docs', newPath: 'notes' }),
    toolResultSucceeded('md_rename'),
    toolResultTextIncludes('md_rename', '"status": "moved"'),
    finalTextIncludes('Mock rename complete.'),
  ],
  async inspect(workspace) {
    if (pathExists(workspace, 'docs')) throw new Error('old directory still exists after move')
    const readme = readText(workspace, 'README.md')
    if (readme !== '[a](notes/a.md)\n[sub](notes/sub/b.md)\n') {
      throw new Error(`in-links not rewritten: ${JSON.stringify(readme)}`)
    }
    // Same-depth move: internal subtree links stay valid unchanged.
    if (readText(workspace, 'notes/a.md') !== '# A\n\n[back](../README.md)\n') {
      throw new Error('subtree a.md changed unexpectedly')
    }
    if (readText(workspace, 'notes/sub/b.md') !== '# B\n\n[up](../a.md)\n') {
      throw new Error('subtree b.md changed unexpectedly')
    }
  },
}
