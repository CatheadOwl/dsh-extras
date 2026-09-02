/**
 * Real intent case: a natural-language rename request must route to
 * `md_rename` with the correct `oldPath`. Only tool selection is asserted
 * (model wording varies); exploration-first ordering is allowed, so this
 * asserts `toolCalled`, not `firstTool`. The exact `newPath` is left
 * unasserted so any reasonable destination passes. Requires a credential;
 * auto-skips otherwise. Complements the mock cases, which prove the write
 * surface works once reached.
 */
import { toolCalled, toolCallArgs } from '@catheadowl/dsh-eval'
import { seedRepo } from '../_fixtures/seed-repo.mjs'

export default {
  id: 'md-rename-real-intent-file-rename',
  mode: 'real',
  task: '把 docs/guide.md 改名为 docs/manual.md，并让仓库里所有指向它的链接继续有效。',
  async prepare(workspace) {
    seedRepo(workspace, {
      'README.md': '[指南](docs/guide.md)\n',
      'docs/guide.md': '# Guide\n\nThis is the guide.\n',
    })
  },
  expect: [
    toolCalled('md_rename'),
    toolCallArgs('md_rename', { oldPath: 'docs/guide.md' }),
  ],
}
