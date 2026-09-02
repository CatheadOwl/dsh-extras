/**
 * Pure-move case: a file with no references anywhere still moves successfully,
 * reporting an empty edit set. Proves the "no references → still succeed"
 * acceptance criterion (spec §8.5).
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
  id: 'md-rename-mock-pure-move',
  mode: 'mock',
  task: 'eval driver: scripted md_rename pure move (no references)',
  async prepare(workspace) {
    seedRepo(workspace, { 'a.md': '# A\n' })
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
    toolResultTextIncludes('md_rename', '"status": "moved"'),
    toolResultTextIncludes('md_rename', '"edited": []'),
    finalTextIncludes('Mock rename complete.'),
  ],
  async inspect(workspace) {
    if (pathExists(workspace, 'a.md')) throw new Error('old path still exists after move')
    if (!pathExists(workspace, 'b.md')) throw new Error('new path missing after move')
    if (readText(workspace, 'b.md') !== '# A\n') throw new Error('moved file content changed')
  },
}
