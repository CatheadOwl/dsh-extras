import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import {
  applyRenamePlan,
  checkRepository,
  planRename,
  rebaseHref,
} from '../lib/links/index.js'

const roots = []

function fixture(files) {
  const root = join(tmpdir(), `dsh-md-links-rename-${process.pid}-${roots.length}`)
  roots.push(root)
  for (const [path, source] of Object.entries(files)) {
    const abs = join(root, path)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, source)
  }
  spawnSync('git', ['init', '-q', root], { stdio: 'ignore' })
  spawnSync('git', ['-C', root, 'add', '-A'], { stdio: 'ignore' })
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('rebaseHref (pure)', () => {
  it('computes a document-relative href from the source directory', () => {
    const root = 'C:\\repo'
    assert.equal(rebaseHref(join(root, 'docs', 'a.md'), join(root, 'README.md')), '../README.md')
    assert.equal(rebaseHref(join(root, 'a.md'), join(root, 'b.md')), 'b.md')
    assert.equal(rebaseHref(join(root, 'a.md'), join(root, 'docs', 'b.md')), 'docs/b.md')
  })
})

describe('planRename / applyRenamePlan (L1 explicit)', () => {
  it('moves a file and rewrites both in-links and out-links', () => {
    const root = fixture({
      'README.md': '[g](docs/deep/guide.md)\n',
      'docs/deep/guide.md': '# Guide\n\n[home](../../README.md)\n',
    })
    const { certain, plan } = planRename(root, 'docs/deep/guide.md', 'guide.md')
    assert.equal(certain, true)
    assert.deepEqual(plan.conflicts, [])

    const result = applyRenamePlan(plan)
    assert.equal(result.moved, true)
    assert.equal(existsSync(join(root, 'docs', 'deep', 'guide.md')), false)
    assert.equal(readFileSync(join(root, 'guide.md'), 'utf8'), '# Guide\n\n[home](README.md)\n')
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '[g](guide.md)\n')
    assert.deepEqual(checkRepository(root), [])
  })

  it('moves a file with no references (pure move) and still succeeds', () => {
    const root = fixture({ 'a.md': '# A\n' })
    const { certain, plan } = planRename(root, 'a.md', 'b.md')
    assert.equal(certain, true)
    const result = applyRenamePlan(plan)
    assert.equal(result.moved, true)
    assert.deepEqual(result.edited, [])
    assert.equal(existsSync(join(root, 'a.md')), false)
    assert.equal(readFileSync(join(root, 'b.md'), 'utf8'), '# A\n')
  })

  it('renames a directory and keeps the subtree internally consistent', () => {
    const root = fixture({
      'README.md': '[a](docs/a.md)\n[sub](docs/sub/b.md)\n',
      'docs/a.md': '# A\n\n[back](../README.md)\n',
      'docs/sub/b.md': '# B\n\n[up](../a.md)\n',
    })
    const { certain, plan } = planRename(root, 'docs', 'notes')
    assert.equal(certain, true)
    assert.deepEqual(plan.conflicts, [])

    applyRenamePlan(plan)
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '[a](notes/a.md)\n[sub](notes/sub/b.md)\n')
    // Same-depth move: `../README.md` and the in-subtree `../a.md` stay valid unchanged.
    assert.equal(readFileSync(join(root, 'notes', 'a.md'), 'utf8'), '# A\n\n[back](../README.md)\n')
    assert.equal(readFileSync(join(root, 'notes', 'sub', 'b.md'), 'utf8'), '# B\n\n[up](../a.md)\n')
    assert.deepEqual(checkRepository(root), [])
  })

  it('rejects the whole plan when newPath already exists', () => {
    const root = fixture({ 'a.md': '# A\n', 'b.md': '# B\n' })
    const { certain, plan } = planRename(root, 'a.md', 'b.md')
    assert.equal(certain, false)
    assert.equal(plan.conflicts.length, 1)
    assert.match(plan.conflicts[0].reason, /already exists/)
    assert.throws(() => applyRenamePlan(plan), /unresolved conflicts/)
    assert.equal(existsSync(join(root, 'a.md')), true)
  })

  it('rejects the whole plan when oldPath is missing', () => {
    const root = fixture({ 'a.md': '# A\n' })
    const { certain, plan } = planRename(root, 'missing.md', 'b.md')
    assert.equal(certain, false)
    assert.match(plan.conflicts[0].reason, /does not exist/)
  })

  it('skips a broken out-link (reported, non-blocking) instead of guessing', () => {
    const root = fixture({
      'docs/guide.md': '# Guide\n\n[broken](missing.md)\n',
    })
    const { certain, plan } = planRename(root, 'docs/guide.md', 'guide.md')
    assert.equal(certain, true)
    assert.equal(plan.skips.length, 1)
    assert.match(plan.skips[0].reason, /target does not exist/)
    applyRenamePlan(plan)
    // Rename does not touch broken links — left verbatim.
    assert.equal(readFileSync(join(root, 'guide.md'), 'utf8'), '# Guide\n\n[broken](missing.md)\n')
  })

  it('reports a pre-broken in-link pointing into the moved subtree instead of silently dropping it', () => {
    // TODO 20260902: lexical landing inside the old subtree, but the target
    // never existed even before the move — must surface as a skip.
    const root = fixture({
      'README.md': '[guide](docs/guide.md)\n[ghost](docs/never-existed.md)\n',
      'docs/guide.md': '# Guide\n',
    })
    const { certain, plan } = planRename(root, 'docs', 'notes')
    assert.equal(certain, true)
    assert.equal(plan.skips.length, 1)
    assert.equal(plan.skips[0].file, 'README.md')
    assert.match(plan.skips[0].reason, /did not exist before the move/)

    applyRenamePlan(plan)
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'),
      '[guide](notes/guide.md)\n[ghost](docs/never-existed.md)\n')
  })

  it('leaves a pre-broken in-link outside the moved subtree to the doc-link gate (no skip)', () => {
    const root = fixture({
      'README.md': '[guide](docs/guide.md)\n[elsewhere](other/missing.md)\n',
      'docs/guide.md': '# Guide\n',
    })
    const { certain, plan } = planRename(root, 'docs', 'notes')
    assert.equal(certain, true)
    assert.deepEqual(plan.skips, [])
    applyRenamePlan(plan)
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'),
      '[guide](notes/guide.md)\n[elsewhere](other/missing.md)\n')
  })

  it('leaves an in-link whose ../ chain escapes the repository root untouched and unreported', () => {
    // TODO 20260902 field case (plugin-publish/02): `../../../docs/…` from a
    // depth-2 file lands OUTSIDE repoRoot — not inside the moved subtree's
    // old namespace, so it stays the doc-link gate's territory. Pin the
    // silence so it is not "fixed" into guessing later.
    const root = fixture({
      'handbooks/plugin-publish/02.md': '[log](../../../docs/upstream-issues/CHANGELOGS.md)\n',
      'docs/upstream-issues/CHANGELOGS.md': '# Logs\n',
    })
    const { certain, plan } = planRename(root, 'docs/upstream-issues', 'upstream-issues')
    assert.equal(certain, true)
    assert.deepEqual(plan.skips, [])
    applyRenamePlan(plan)
    assert.equal(readFileSync(join(root, 'handbooks/plugin-publish/02.md'), 'utf8'),
      '[log](../../../docs/upstream-issues/CHANGELOGS.md)\n')
  })

  it('preserves a fragment suffix through the rewrite', () => {
    const root = fixture({
      'README.md': '[x](docs/guide.md#start)\n',
      'docs/guide.md': '# Start\n',
    })
    const { certain, plan } = planRename(root, 'docs/guide.md', 'notes/guide.md')
    assert.equal(certain, true)
    applyRenamePlan(plan)
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '[x](notes/guide.md#start)\n')
    assert.deepEqual(checkRepository(root), [])
  })
})

describe('planRename frozen sources (isFrozen option)', () => {
  const frozenArchived = root => (abs) =>
    abs.slice(root.length + 1).split(/[\\/]/).slice(0, -1).includes('archived')

  it('moves an active target but leaves a frozen holder untouched (skip + report, bytes frozen)', () => {
    const root = fixture({
      'archived/old-note.md': '[still points at docs](../docs/guide.md)\n',
      'docs/guide.md': '# Guide\n',
    })
    const { certain, plan } = planRename(root, 'docs/guide.md', 'guide.md', { isFrozen: frozenArchived(root) })
    assert.equal(certain, true)
    assert.equal(plan.editsByFile.size, 0)
    assert.equal(plan.skips.length, 1)
    assert.equal(plan.skips[0].file, 'archived/old-note.md')
    assert.match(plan.skips[0].reason, /frozen/)
    applyRenamePlan(plan)
    assert.equal(readFileSync(join(root, 'archived/old-note.md'), 'utf8'), '[still points at docs](../docs/guide.md)\n')
    assert.equal(existsSync(join(root, 'guide.md')), true)
  })

  it('the archival move itself is not exempt: a non-frozen source moving into a frozen dir is fully rewritten', () => {
    const root = fixture({
      'README.md': '[guide](docs/deep/guide.md)\n',
      'docs/deep/guide.md': '# Guide\n\n[home](../../README.md)\n',
    })
    const { certain, plan } = planRename(root, 'docs/deep/guide.md', 'archived/docs/deep/guide.md', { isFrozen: frozenArchived(root) })
    assert.equal(certain, true)
    applyRenamePlan(plan)
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '[guide](archived/docs/deep/guide.md)\n')
    assert.equal(readFileSync(join(root, 'archived', 'docs', 'deep', 'guide.md'), 'utf8'), '# Guide\n\n[home](../../../README.md)\n')
  })

  it('a frozen file moving with a renamed parent subtree moves unchanged, its would-be rewrites reported', () => {
    const root = fixture({
      'work/README.md': '[archived doc](docs/archived/old.md)\n',
      'work/docs/archived/old.md': '[escape](../../../README.md)\n',
      'README.md': '# Root\n',
    })
    // Depth-changing move (work/docs → docs): the frozen out-link would need
    // a rebase (../../../README.md → ../../README.md) — it must NOT happen.
    const { certain, plan } = planRename(root, 'work/docs', 'docs', { isFrozen: frozenArchived(root) })
    assert.equal(certain, true)
    applyRenamePlan(plan)
    // Frozen bytes move verbatim; the stale out-link surfaces as a skip at its pre-move path.
    assert.equal(readFileSync(join(root, 'docs', 'archived', 'old.md'), 'utf8'), '[escape](../../../README.md)\n')
    const frozenSkip = plan.skips.find(s => s.file === 'work/docs/archived/old.md')
    assert.ok(frozenSkip !== undefined, 'frozen out-link rewrite is reported as a skip')
    assert.match(frozenSkip.reason, /frozen/)
    // Active holders were still rewritten.
    assert.equal(readFileSync(join(root, 'work', 'README.md'), 'utf8'), '[archived doc](../docs/archived/old.md)\n')
  })
})
