/**
 * Mirrored-label case: a link whose visible label is its own destination (here
 * the path without `.md`) follows the target's new name, while a prose label in
 * the same file only follows the path. The rewrite is reported in `relabels`,
 * so the cosmetic half of the edit stays auditable.
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
  id: 'md-rename-mock-relabel',
  mode: 'mock',
  task: 'eval driver: scripted md_rename with a mirrored label',
  async prepare(workspace) {
    seedRepo(workspace, {
      'README.md': 'see [docs/glossary](docs/glossary.md) and [the guide](docs/glossary.md)\n',
      'docs/glossary.md': '# G\n',
    })
  },
  script: {
    steps: [
      toolCallStep('md_rename', { oldPath: 'docs/glossary.md', newPath: 'docs/lexicon.md' }),
      textStep('Mock rename complete.'),
    ],
  },
  expect: [
    firstTool('md_rename'),
    toolCallArgs('md_rename', { oldPath: 'docs/glossary.md', newPath: 'docs/lexicon.md' }),
    toolResultSucceeded('md_rename'),
    toolResultTextIncludes('md_rename', '"status": "moved"'),
    toolResultTextIncludes('md_rename', '"from": "docs/glossary"'),
    toolResultTextIncludes('md_rename', '"to": "docs/lexicon"'),
    finalTextIncludes('Mock rename complete.'),
  ],
  async inspect(workspace) {
    const expected = 'see [docs/lexicon](docs/lexicon.md) and [the guide](docs/lexicon.md)\n'
    const readme = readText(workspace, 'README.md')
    if (readme !== expected) {
      throw new Error(`mirror label did not follow the destination: ${JSON.stringify(readme)}`)
    }
  },
}
