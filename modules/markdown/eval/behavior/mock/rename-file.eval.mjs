/**
 * Deterministic rebase case: one file move that must rewrite an in-link
 * (README → the moved file) AND rebase the moved file's out-link (back to
 * README) across a depth change. Proves the happy path of the L1 fallback
 * ladder: both directions rewrite byte-exactly and the repo ends link-clean.
 */
import {
  firstTool,
  toolCallArgs,
  toolMounted,
  toolResultSucceeded,
  toolResultTextIncludes,
  finalTextIncludes,
  toolCallStep,
  textStep,
} from '@catheadowl/dsh-eval'
import { pathExists, readText, seedRepo } from '../_fixtures/seed-repo.mjs'

export default {
  id: 'md-rename-mock-file-inlink-outlink',
  mode: 'mock',
  task: 'eval driver: scripted md_rename file move (in-link rewrite + out-link rebase)',
  async prepare(workspace) {
    seedRepo(workspace, {
      'README.md': '[g](docs/deep/guide.md)\n',
      'docs/deep/guide.md': '# Guide\n\n[home](../../README.md)\n',
    })
  },
  script: {
    steps: [
      toolCallStep('md_rename', { oldPath: 'docs/deep/guide.md', newPath: 'guide.md' }),
      textStep('Mock rename complete.'),
    ],
  },
  expect: [
    firstTool('md_rename'),
    toolMounted('md_rename'),
    toolCallArgs('md_rename', { oldPath: 'docs/deep/guide.md', newPath: 'guide.md' }),
    toolResultSucceeded('md_rename'),
    toolResultTextIncludes('md_rename', '"status": "moved"'),
    finalTextIncludes('Mock rename complete.'),
  ],
  async inspect(workspace) {
    if (pathExists(workspace, 'docs/deep/guide.md')) throw new Error('old path still exists after move')
    if (!pathExists(workspace, 'guide.md')) throw new Error('new path missing after move')
    const readme = readText(workspace, 'README.md')
    if (readme !== '[g](guide.md)\n') throw new Error(`in-link not rewritten: ${JSON.stringify(readme)}`)
    const moved = readText(workspace, 'guide.md')
    if (moved !== '# Guide\n\n[home](README.md)\n') throw new Error(`out-link not rebased: ${JSON.stringify(moved)}`)
  },
}
