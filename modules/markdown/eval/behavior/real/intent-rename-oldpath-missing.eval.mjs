/**
 * Real intent case (missing old path, plain conflict): a rename request for
 * a path that never existed (user typo) — neither old nor new is on disk,
 * so no rename-in-progress signal exists and the tool's plain
 * old-path-missing conflict (not the post-hoc no-evidence refusal) is the
 * designed outcome. Pins the delegation boundary: the agent routes the
 * pair to md_rename and lets the tool refuse, instead of silently
 * no-op'ing, asking into the void, or fabricating the missing source. The
 * repo deliberately contains no link to old.md so the turn-close doc-link
 * gate stays silent (its interaction with intentionally-broken final
 * states is a separately filed workunit). Requires a credential;
 * auto-skips otherwise.
 */
import { toolCalled, toolCallArgs, toolResultTextIncludes } from '@catheadowl/dsh-eval'
import { pathExists, seedRepo } from '../_fixtures/seed-repo.mjs'

export default {
  id: 'md-rename-real-intent-oldpath-missing-typo',
  mode: 'real',
  task: '把 old.md 改名为 new.md。',
  async prepare(workspace) {
    // old.md never existed and nothing links to it: no rename signal at all.
    seedRepo(workspace, {
      'README.md': '# Repo\n\n[notes](notes.md)\n',
      'notes.md': '# Notes\n',
    })
  },
  expect: [
    toolCalled('md_rename'),
    toolCallArgs('md_rename', { oldPath: 'old.md', newPath: 'new.md' }),
    toolResultTextIncludes('md_rename', '"status": "conflict"'),
    toolResultTextIncludes('md_rename', 'old path does not exist'),
  ],
  async inspect(workspace) {
    if (pathExists(workspace, 'old.md')) throw new Error('the agent fabricated the missing source file')
    if (pathExists(workspace, 'new.md')) throw new Error('the agent fabricated the destination')
  },
}
