/**
 * Conflict ladder case (blocking): a destination escaping the repository root
 * is refused with an `outside the repository` conflict and nothing is written.
 * The escape target is defensively removed in `prepare` so a leftover from a
 * prior crashed run cannot masquerade as "already exists".
 */
import { rmSync } from 'node:fs'
import { join } from 'node:path'
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

const ESCAPE_TARGET = 'md-rename-eval-escape-target.md'

export default {
  id: 'md-rename-mock-conflict-outside-repo',
  mode: 'mock',
  task: 'eval driver: scripted md_rename refused on outside-repository destination',
  async prepare(workspace) {
    rmSync(join(workspace, '..', ESCAPE_TARGET), { force: true })
    seedRepo(workspace, { 'a.md': '# A\n' })
  },
  script: {
    steps: [
      toolCallStep('md_rename', { oldPath: 'a.md', newPath: `../${ESCAPE_TARGET}` }),
      textStep('Mock rename complete.'),
    ],
  },
  expect: [
    firstTool('md_rename'),
    toolCallArgs('md_rename', { oldPath: 'a.md', newPath: `../${ESCAPE_TARGET}` }),
    toolResultSucceeded('md_rename'),
    toolResultTextIncludes('md_rename', '"status": "conflict"'),
    toolResultTextIncludes('md_rename', 'outside the repository'),
    finalTextIncludes('Mock rename complete.'),
  ],
  async inspect(workspace) {
    if (pathExists(workspace, join('..', ESCAPE_TARGET))) throw new Error('escape target was created')
    if (readText(workspace, 'a.md') !== '# A\n') throw new Error('a.md was mutated on conflict')
  },
}
