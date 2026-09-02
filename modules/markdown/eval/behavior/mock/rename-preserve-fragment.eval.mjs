/**
 * Fragment-preservation case: an in-link carrying a `#anchor` keeps its
 * fragment suffix byte-exactly through the rewrite (spec §2 precondition 3).
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
import { readText, seedRepo } from '../_fixtures/seed-repo.mjs'

export default {
  id: 'md-rename-mock-preserve-fragment',
  mode: 'mock',
  task: 'eval driver: scripted md_rename with fragment preservation',
  async prepare(workspace) {
    seedRepo(workspace, {
      'README.md': '[x](docs/guide.md#start)\n',
      'docs/guide.md': '# Start\n',
    })
  },
  script: {
    steps: [
      toolCallStep('md_rename', { oldPath: 'docs/guide.md', newPath: 'notes/guide.md' }),
      textStep('Mock rename complete.'),
    ],
  },
  expect: [
    firstTool('md_rename'),
    toolCallArgs('md_rename', { oldPath: 'docs/guide.md', newPath: 'notes/guide.md' }),
    toolResultSucceeded('md_rename'),
    toolResultTextIncludes('md_rename', '"status": "moved"'),
    finalTextIncludes('Mock rename complete.'),
  ],
  async inspect(workspace) {
    const readme = readText(workspace, 'README.md')
    if (readme !== '[x](notes/guide.md#start)\n') {
      throw new Error(`fragment not preserved: ${JSON.stringify(readme)}`)
    }
  },
}
