/**
 * External/absolute-target case: `https:`, `//`, `/`, and `mailto:` references
 * are `ignored` (not internal links, not even a skip) and left byte-exact,
 * while the move succeeds. Proves the external/scheme/absolute branch of the
 * resolution seam (spec §2 + §5).
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
import { readText, seedRepo } from '../_fixtures/seed-repo.mjs'

const GUIDE =
  '# Guide\n'
  + '\n'
  + '[e1](https://example.com/x)\n'
  + '[e2](/abs.md)\n'
  + '[e3](//cdn.example.com/x)\n'
  + '[e4](mailto:a@b.c)\n'

export default {
  id: 'md-rename-mock-skip-external',
  mode: 'mock',
  task: 'eval driver: scripted md_rename with external/absolute targets (ignored)',
  async prepare(workspace) {
    seedRepo(workspace, { 'docs/guide.md': GUIDE })
  },
  script: {
    steps: [
      toolCallStep('md_rename', { oldPath: 'docs/guide.md', newPath: 'guide.md' }),
      textStep('Mock rename complete.'),
    ],
  },
  expect: [
    firstTool('md_rename'),
    toolCallArgs('md_rename', { oldPath: 'docs/guide.md', newPath: 'guide.md' }),
    toolResultSucceeded('md_rename'),
    toolResultTextIncludes('md_rename', '"status": "moved"'),
    toolResultTextIncludes('md_rename', '"skips": []'),
    finalTextIncludes('Mock rename complete.'),
  ],
  async inspect(workspace) {
    if (readText(workspace, 'guide.md') !== GUIDE) {
      throw new Error('external/absolute targets were not left byte-exact')
    }
  },
}
