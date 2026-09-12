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
  relabelFor,
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

describe('relabelFor (pure mirror rule)', () => {
  it('recomputes the same rendering the author used', () => {
    assert.equal(relabelFor('docs/guide.md', 'docs/guide.md', 'notes/intro.md'), 'notes/intro.md')
    assert.equal(relabelFor('docs/guide', 'docs/guide.md', 'notes/intro.md'), 'notes/intro')
    assert.equal(relabelFor('guide.md', '../docs/guide.md', 'notes/intro.md'), 'intro.md')
    assert.equal(relabelFor('guide', 'docs/guide.md', 'notes/intro.md'), 'intro')
  })

  it('leaves author prose alone, however path-shaped it looks', () => {
    assert.equal(relabelFor('the guide', 'docs/guide.md', 'notes/intro.md'), undefined)
    assert.equal(relabelFor('docs/touch.md', 'docs/guide.md', 'notes/intro.md'), undefined)
    assert.equal(relabelFor('`guide.md`', 'docs/guide.md', 'notes/intro.md'), undefined)
  })

  it('keeps the label when it already renders the new destination (pure move)', () => {
    assert.equal(relabelFor('guide.md', '../docs/guide.md', '../notes/guide.md'), undefined)
    assert.equal(relabelFor('a.md', 'a.md', 'docs/a.md'), undefined)
  })

  it('follows the name, not the path, when a bare-filename link moves away', () => {
    // Identity and last segment both matched the old path; the name rendering
    // wins, so the label keeps the author's own extension style.
    assert.equal(relabelFor('a', 'a.md', 'moved/guide.md'), 'guide')
    assert.equal(relabelFor('a.md', 'a.md', 'docs/b.md'), 'b.md')
  })

  it('never proposes a rendering that cannot be written inside [...]', () => {
    assert.equal(relabelFor('a.md', 'a.md', 'weird].md'), undefined)
  })
})

describe('planRename mirrored labels', () => {
  const frozenArchived = root => (abs) =>
    abs.slice(root.length + 1).split(/[\\/]/).slice(0, -1).includes('archived')

  it('relabels a self-titled in-link and reports it', () => {
    const root = fixture({
      'README.md': '[docs/guide.md](docs/guide.md)\n',
      'docs/guide.md': '# Guide\n',
    })
    const { certain, plan } = planRename(root, 'docs/guide.md', 'docs/intro.md')
    assert.equal(certain, true)
    assert.equal(plan.editsByFile.size, 1)
    assert.deepEqual(plan.relabels, [
      { file: 'README.md', line: 1, from: 'docs/guide.md', to: 'docs/intro.md' },
    ])
    applyRenamePlan(plan)
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '[docs/intro.md](docs/intro.md)\n')
    assert.deepEqual(checkRepository(root), [])
  })

  it('keeps the house rendering (path without the .md extension)', () => {
    const root = fixture({
      'README.md': 'see [docs/glossary](docs/glossary.md) for terms\n',
      'docs/glossary.md': '# G\n',
    })
    const { plan } = planRename(root, 'docs/glossary.md', 'docs/lexicon.md')
    applyRenamePlan(plan)
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), 'see [docs/lexicon](docs/lexicon.md) for terms\n')
    assert.deepEqual(plan.relabels, [
      { file: 'README.md', line: 1, from: 'docs/glossary', to: 'docs/lexicon' },
    ])
  })

  it('relabels a basename mirror held in another directory', () => {
    const root = fixture({
      'work/README.md': '[guide.md](../docs/guide.md)\n',
      'docs/guide.md': '# Guide\n',
    })
    const { plan } = planRename(root, 'docs/guide.md', 'docs/intro.md')
    applyRenamePlan(plan)
    assert.equal(readFileSync(join(root, 'work', 'README.md'), 'utf8'), '[intro.md](../docs/intro.md)\n')
  })

  it('relabels the moved file\'s own out-link mirror, reported at its pre-move path', () => {
    const root = fixture({
      'guide.md': '# Guide\n\n[docs/glossary](docs/glossary.md)\n',
      'docs/glossary.md': '# G\n',
    })
    const { plan } = planRename(root, 'guide.md', 'notes/deep/guide.md')
    applyRenamePlan(plan)
    // The label mirrors the cited href (path without `.md`), so it follows the
    // rebased `../` chain out of the new depth.
    assert.equal(readFileSync(join(root, 'notes', 'deep', 'guide.md'), 'utf8'),
      '# Guide\n\n[../../docs/glossary](../../docs/glossary.md)\n')
    assert.deepEqual(plan.relabels, [
      { file: 'guide.md', line: 3, from: 'docs/glossary', to: '../../docs/glossary' },
    ])
  })

  it('keeps a name-unchanged link\'s label, and follows the one that names the path', () => {
    const root = fixture({
      'README.md': '[a.md](docs/a.md)\n[docs/a.md](docs/a.md)\n',
      'docs/a.md': '# A\n',
    })
    const { plan } = planRename(root, 'docs', 'notes')
    applyRenamePlan(plan)
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '[a.md](notes/a.md)\n[notes/a.md](notes/a.md)\n')
    assert.deepEqual(plan.relabels, [
      { file: 'README.md', line: 2, from: 'docs/a.md', to: 'notes/a.md' },
    ])
  })

  it('leaves prose labels and path-shaped non-mirrors alone, silently', () => {
    const root = fixture({
      'README.md': '[the guide](docs/guide.md)\n[docs/touch.md](docs/cookbook.md)\n',
      'docs/guide.md': '# Guide\n',
      'docs/cookbook.md': '# C\n',
    })
    const { plan } = planRename(root, 'docs/guide.md', 'docs/intro.md')
    applyRenamePlan(plan)
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'),
      '[the guide](docs/intro.md)\n[docs/touch.md](docs/cookbook.md)\n')
    assert.deepEqual(plan.relabels, [])
    assert.deepEqual(plan.skips, [])
  })

  it('rewrites a definition destination but never its key label', () => {
    const root = fixture({
      'README.md': '[guide]: docs/guide.md\n\nsee [the guide][guide]\n',
      'docs/guide.md': '# Guide\n',
    })
    const { plan } = planRename(root, 'docs/guide.md', 'notes/guide.md')
    applyRenamePlan(plan)
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '[guide]: notes/guide.md\n\nsee [the guide][guide]\n')
    assert.deepEqual(plan.relabels, [])
  })

  it('relabels an image alt that mirrors the image path', () => {
    const root = fixture({
      'README.md': '![arch.png](docs/arch.png)\n',
      'docs/arch.png': 'png\n',
    })
    const { plan } = planRename(root, 'docs/arch.png', 'docs/diagram.png')
    applyRenamePlan(plan)
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '![diagram.png](docs/diagram.png)\n')
    assert.deepEqual(plan.relabels, [
      { file: 'README.md', line: 1, from: 'arch.png', to: 'diagram.png' },
    ])
  })

  it('drops the label edit with the rest of a frozen source\'s rewrite', () => {
    const root = fixture({
      'archived/holder.md': '[guide.md](../docs/guide.md)\n',
      'docs/guide.md': '# Guide\n',
    })
    const { certain, plan } = planRename(root, 'docs/guide.md', 'docs/intro.md', { isFrozen: frozenArchived(root) })
    assert.equal(certain, true)
    assert.equal(plan.editsByFile.size, 0)
    assert.deepEqual(plan.relabels, [])
    assert.match(plan.skips[0].reason, /frozen/)
    applyRenamePlan(plan)
    assert.equal(readFileSync(join(root, 'archived', 'holder.md'), 'utf8'), '[guide.md](../docs/guide.md)\n')
  })
})

// The mirror rule's whole safety argument is "exact equality against a closed
// rendering set". These pin the near-misses: every one of them must keep its
// bytes while the destination is still rewritten.
describe('mirrored labels — false positives stay untouched', () => {
  it('keeps a stale path-shaped label when its OWN destination moves', () => {
    // The label names what the file was called before an EARLIER rename. The
    // rule judges against the current href, so this is prose: the destination
    // must follow and the text must not (no rot repair, and no new rot).
    const root = fixture({
      'README.md': '[docs/touch.md](docs/cookbook.md)\n',
      'docs/cookbook.md': '# C\n',
    })
    const { plan } = planRename(root, 'docs/cookbook.md', 'docs/cooking.md')
    applyRenamePlan(plan)
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '[docs/touch.md](docs/cooking.md)\n')
    assert.deepEqual(plan.relabels, [])
    assert.deepEqual(plan.skips, [])
  })

  it('rewrites a code-span label\'s destination but leaves the label', () => {
    const root = fixture({
      'README.md': 'see [`guide.md`](docs/guide.md)\n',
      'docs/guide.md': '# G\n',
    })
    const { plan } = planRename(root, 'docs/guide.md', 'docs/intro.md')
    applyRenamePlan(plan)
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), 'see [`guide.md`](docs/intro.md)\n')
    assert.deepEqual(plan.relabels, [])
  })

  it('leaves a directory-homepage label (README.md target) alone', () => {
    const root = fixture({
      'README.md': '[docs](docs/README.md)\n',
      'docs/README.md': '# Docs\n',
    })
    const { plan } = planRename(root, 'docs/README.md', 'docs/guide.md')
    applyRenamePlan(plan)
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '[docs](docs/guide.md)\n')
    assert.deepEqual(plan.relabels, [])
  })

  it('leaves a non-mirroring image alt alone while the destination follows', () => {
    const root = fixture({
      'README.md': '![architecture](docs/arch.png)\n',
      'docs/arch.png': 'png\n',
    })
    const { plan } = planRename(root, 'docs/arch.png', 'docs/diagram.png')
    applyRenamePlan(plan)
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '![architecture](docs/diagram.png)\n')
    assert.deepEqual(plan.relabels, [])
  })

  it('treats near-misses as prose (case, whitespace, ./ prefix, suffix)', () => {
    assert.equal(relabelFor('docs/Glossary.md', 'docs/glossary.md', 'docs/lexicon.md'), undefined)
    assert.equal(relabelFor('docs/glossary.md ', 'docs/glossary.md', 'docs/lexicon.md'), undefined)
    assert.equal(relabelFor('docs/ glossary', 'docs/glossary.md', 'docs/lexicon.md'), undefined)
    // A self-titled link WITH a fragment/suffix is outside the closed set: the
    // label keeps the full authored url, which no rendering produces.
    assert.equal(relabelFor('guide.md#start', 'guide.md', 'intro.md'), undefined)
    // `./x.md` is path-shaped but is not a rendering of `x.md` (v1 non-coverage).
    assert.equal(relabelFor('./guide.md', 'guide.md', 'intro.md'), undefined)
  })

  it('keeps a label that already names the NEW file (no reverse inference)', () => {
    // The href still points at the old path; the text happens to name the new
    // one. Not a rendering of the CURRENT destination → never touched, and the
    // tool never rewrites hrefs to match a label.
    assert.equal(relabelFor('lexicon', 'docs/glossary.md', 'docs/lexicon.md'), undefined)
  })

  it('still rewrites the exact renderings — the bare stem is the intended semantics', () => {
    assert.equal(relabelFor('a', 'a.md', 'b.md'), 'b') // in-place rename, no-extension shape
    // The bare stem is this repo's canonical label for a file name (406 links);
    // following it is the rule's point, not a tolerated edge case (ADR 0005).
    assert.equal(relabelFor('glossary', 'docs/glossary.md', 'docs/lexicon.md'), 'lexicon')
    assert.equal(relabelFor('arch.png', 'docs/arch.png', 'docs/diagram.png'), 'diagram.png')
    assert.equal(relabelFor('arch', 'docs/arch.png', 'docs/diagram.png'), undefined) // no `.md` to drop → prose
  })
})
