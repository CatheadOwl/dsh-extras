/**
 * Skip ladder case (non-blocking): a broken out-link is reported as a skip and
 * left verbatim, while the move itself still succeeds. Proves the "conflict →
 * skip + report, never guess" fallback: rename does not touch broken links
 * (spec §5).
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

export default {
  id: 'md-rename-mock-skip-broken-outlink',
  mode: 'mock',
  task: 'eval driver: scripted md_rename with a broken out-link (skip + report)',
  async prepare(workspace) {
    seedRepo(workspace, { 'docs/guide.md': '# Guide\n\n[broken](missing.md)\n' })
  },
  // This case's end state deliberately keeps a broken link; the turn-close
  // doc-link gate would splice trailing feedback steps past the script's
  // terminal text. Declaring `gates: 'off'` holds the script's last step as
  // the final text, so finalText keeps its deterministic meaning.
  gates: 'off',
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
    toolResultTextIncludes('md_rename', 'target does not exist'),
    finalTextIncludes('Mock rename complete.'),
  ],
  async inspect(workspace) {
    if (pathExists(workspace, 'docs/guide.md')) throw new Error('old path still exists after move')
    // Broken out-link is reported, not guessed: left verbatim.
    if (readText(workspace, 'guide.md') !== '# Guide\n\n[broken](missing.md)\n') {
      throw new Error('broken out-link was touched instead of skipped')
    }
  },
}
