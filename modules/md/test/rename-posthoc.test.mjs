import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import {
  REASON_NO_RENAME_EVIDENCE,
  applyRenamePlan,
  checkRepository,
  planRename,
} from '../lib/links/index.js'
import { armGitTrace, disarmGitTrace, gitSpawnCounts, gitTraceTarget, totalSpawns } from './helpers/git-trace.mjs'

// Post-hoc repair acceptance (workunits/md-rename TODO
// 20260831-posthoc-repair-mode, cases 1–9): md_rename accepts an
// already-happened rename — oldPath missing + newPath present + git evidence
// — and repairs links only.

const roots = []
// Monotonic and never reset: afterEach clears `roots` for cleanup, so
// `roots.length` would restart at 0 and reuse the same tmp path — while the
// lib's module-level gitTopLevel cache survives across tests, which would
// silently hide the rev-parse spawn from the budget assertions below.
let fixtureSeq = 0

function fixture(files) {
  const root = join(tmpdir(), `dsh-md-links-posthoc-${process.pid}-${fixtureSeq++}`)
  roots.push(root)
  for (const [path, source] of Object.entries(files)) {
    const abs = join(root, path)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, source)
  }
  spawnSync('git', ['init', '-q', root], { stdio: 'ignore' })
  spawnSync('git', ['-C', root, 'add', '-A'], { stdio: 'ignore' })
  spawnSync('git', ['-C', root, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { stdio: 'ignore' })
  return root
}

afterEach(() => {
  disarmGitTrace()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('planRename / applyRenamePlan (post-hoc repair)', () => {
  // Case 1: file post-hoc — worktree move (D old + new on disk).
  it('repairs links only when the rename already happened in the worktree', () => {
    const root = fixture({
      'a.md': '# A\n\n[home](README.md)\n',
      'README.md': '[a](a.md)\n',
    })
    mkdirSync(join(root, 'moved'))
    renameSync(join(root, 'a.md'), join(root, 'moved', 'guide.md'))

    const { certain, plan } = planRename(root, 'a.md', 'moved/guide.md')
    assert.equal(certain, true)
    assert.equal(plan.linkOnly, true)
    const result = applyRenamePlan(plan)
    assert.equal(result.moved, false)
    assert.deepEqual([...result.edited].sort(), ['README.md', 'moved/guide.md'])

    // No move was performed: the old path stays gone, the new file stays put.
    assert.equal(existsSync(join(root, 'a.md')), false)
    // In-link rewritten to the new location; out-link rebased from the old baseline.
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '[a](moved/guide.md)\n')
    assert.equal(readFileSync(join(root, 'moved', 'guide.md'), 'utf8'), '# A\n\n[home](../README.md)\n')
    assert.deepEqual(checkRepository(root), [])
  })

  // Case 2: HEAD-tier witness — the worktree cannot show the rename
  // (skip-worktree hides the deletion) but HEAD still records old.
  it('accepts the HEAD-tier witness when the worktree shows nothing', () => {
    const root = fixture({
      'old.md': '# Old\n\n[home](README.md)\n',
      'README.md': '[x](old.md)\n',
    })
    spawnSync('git', ['-C', root, 'update-index', '--skip-worktree', 'old.md'], { stdio: 'ignore' })
    renameSync(join(root, 'old.md'), join(root, 'new.md'))

    const { certain, plan } = planRename(root, 'old.md', 'new.md')
    assert.equal(certain, true)
    assert.equal(plan.linkOnly, true)
    const result = applyRenamePlan(plan)
    assert.equal(result.moved, false)
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '[x](new.md)\n')
    // Depth-preserving move: the out-link href stays valid unchanged.
    assert.equal(readFileSync(join(root, 'new.md'), 'utf8'), '# Old\n\n[home](README.md)\n')
    assert.deepEqual(checkRepository(root), [])
  })

  // Case 3: directory post-hoc — subtree-internal links unchanged, external
  // in-links rewritten.
  it('repairs a whole moved directory', () => {
    const root = fixture({
      'README.md': '[a](docs/a.md)\n[sub](docs/sub/b.md)\n',
      'docs/a.md': '# A\n\n[back](../README.md)\n',
      'docs/sub/b.md': '# B\n\n[up](../a.md)\n',
    })
    renameSync(join(root, 'docs'), join(root, 'notes'))

    const { certain, plan } = planRename(root, 'docs', 'notes')
    assert.equal(certain, true)
    assert.equal(plan.linkOnly, true)
    applyRenamePlan(plan)
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '[a](notes/a.md)\n[sub](notes/sub/b.md)\n')
    // Same-depth move: relative hrefs inside the subtree stay valid unchanged.
    assert.equal(readFileSync(join(root, 'notes', 'a.md'), 'utf8'), '# A\n\n[back](../README.md)\n')
    assert.equal(readFileSync(join(root, 'notes', 'sub', 'b.md'), 'utf8'), '# B\n\n[up](../a.md)\n')
    assert.deepEqual(checkRepository(root), [])
  })

  // Case 4: spawn budget — status 1 + cat-file ≤1, no gitMove (F4 helper).
  it('stays within the spawn budget on the worktree tier (no cat-file, no mv)', () => {
    const root = fixture({
      'a.md': '# A\n\n[home](README.md)\n',
      'README.md': '[a](a.md)\n',
    })
    mkdirSync(join(root, 'moved'))
    renameSync(join(root, 'a.md'), join(root, 'moved', 'guide.md'))

    const target = gitTraceTarget(root)
    armGitTrace(target)
    const { certain, plan } = planRename(root, 'a.md', 'moved/guide.md')
    assert.equal(certain, true)
    applyRenamePlan(plan)
    const counts = gitSpawnCounts(target)
    disarmGitTrace()

    assert.equal(counts.get('rev-parse'), 1)
    assert.equal(counts.get('status'), 1)
    assert.equal(counts.get('grep'), 1)
    assert.equal(counts.get('cat-file'), undefined) // worktree evidence found → HEAD tier never runs
    assert.equal(counts.get('mv'), undefined) // link-only: no move
    assert.equal(totalSpawns(counts), 3)
  })

  it('stays within the spawn budget on the HEAD tier (cat-file once, no mv)', () => {
    const root = fixture({
      'old.md': '# Old\n\n[home](README.md)\n',
      'README.md': '[x](old.md)\n',
    })
    spawnSync('git', ['-C', root, 'update-index', '--skip-worktree', 'old.md'], { stdio: 'ignore' })
    renameSync(join(root, 'old.md'), join(root, 'new.md'))

    const target = gitTraceTarget(root)
    armGitTrace(target)
    const { certain, plan } = planRename(root, 'old.md', 'new.md')
    assert.equal(certain, true)
    applyRenamePlan(plan)
    const counts = gitSpawnCounts(target)
    disarmGitTrace()

    assert.equal(counts.get('rev-parse'), 1)
    assert.equal(counts.get('status'), 1)
    assert.equal(counts.get('cat-file'), 1)
    assert.equal(counts.get('grep'), 1)
    assert.equal(counts.get('mv'), undefined)
    assert.equal(totalSpawns(counts), 4)
  })

  // Case 5: an old-pointing in-link is either rewritten or reported — never
  // silently dropped by an existsSync gate.
  it('reports an in-link whose target was deleted under old instead of moving', () => {
    const root = fixture({
      'docs/a.md': '# A\n',
      'docs/deleted.md': '# D\n',
      'README.md': '[ok](docs/a.md)\n',
      'holder.md': '[gone](docs/deleted.md)\n',
    })
    rmSync(join(root, 'docs', 'deleted.md'))
    renameSync(join(root, 'docs'), join(root, 'notes'))

    const { certain, plan } = planRename(root, 'docs', 'notes')
    assert.equal(certain, true)
    const reported = plan.skips.filter(s => s.file === 'holder.md')
    assert.equal(reported.length, 1)
    assert.match(reported[0].reason, /not moved to the new location/)

    applyRenamePlan(plan)
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '[ok](notes/a.md)\n')
    // Reported, not guessed: the reference is left verbatim.
    assert.equal(readFileSync(join(root, 'holder.md'), 'utf8'), '[gone](docs/deleted.md)\n')
  })

  // Case 6: no git evidence (untracked old / typo'd old) → refuse, never guess.
  it('refuses without git evidence of the completed rename', () => {
    const root = fixture({ 'README.md': '# R\n' })
    mkdirSync(join(root, 'untracked'), { recursive: true })
    writeFileSync(join(root, 'untracked', 'u.md'), '# U\n')
    renameSync(join(root, 'untracked'), join(root, 'moved'))
    const untracked = planRename(root, 'untracked', 'moved')
    assert.equal(untracked.certain, false)
    assert.equal(untracked.plan.conflicts[0].reason, REASON_NO_RENAME_EVIDENCE)

    // A typo'd old next to an existing new path is the same evidence-free state.
    const typo = planRename(root, 'typo.md', 'README.md')
    assert.equal(typo.certain, false)
    assert.equal(typo.plan.conflicts[0].reason, REASON_NO_RENAME_EVIDENCE)
  })

  it('refuses when git staged the rename away to a different destination', () => {
    const root = fixture({ 'a.md': '# A\n' })
    spawnSync('git', ['-C', root, 'mv', 'a.md', 'elsewhere.md'], { stdio: 'ignore' })
    writeFileSync(join(root, 'b.md'), '# B\n')
    const { certain, plan } = planRename(root, 'a.md', 'b.md')
    assert.equal(certain, false)
    assert.equal(plan.conflicts[0].reason, REASON_NO_RENAME_EVIDENCE)
  })

  // Boundary of the two evidence tiers: a FULLY COMMITTED rename leaves old
  // absent from HEAD and a clean worktree — neither tier can witness it, so
  // D1 refuses (discovery of the true old belongs to remedy ①, git log --follow).
  it('refuses a fully-committed rename (old not in HEAD, worktree clean)', () => {
    const root = fixture({
      'a.md': '# A\n\n[home](README.md)\n',
      'README.md': '[a](a.md)\n',
    })
    mkdirSync(join(root, 'moved'))
    renameSync(join(root, 'a.md'), join(root, 'moved', 'guide.md'))
    spawnSync('git', ['-C', root, 'add', '-A'], { stdio: 'ignore' })
    spawnSync('git', ['-C', root, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'moved'], { stdio: 'ignore' })

    const { certain, plan } = planRename(root, 'a.md', 'moved/guide.md')
    assert.equal(certain, false)
    assert.equal(plan.linkOnly, false)
    assert.equal(plan.conflicts[0].reason, REASON_NO_RENAME_EVIDENCE)
    // Refusal writes nothing: the stale in-link stays verbatim for the agent.
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '[a](a.md)\n')
  })

  // Case 7 (D2 counterexample): an unrelated file already living under
  // newPath is not part of the move — its out-links stay untouched while its
  // own references into old are rewritten as ordinary in-links.
  it('never rebases an unproven neighbor under newPath', () => {
    const root = fixture({
      'a/b/f.md': '# F\n',
      'x/extra.md': '[s](../shared.md)\n[into](../a/b/f.md)\n',
      'shared.md': '# Shared\n',
      'README.md': '[f](a/b/f.md)\n',
    })
    renameSync(join(root, 'a', 'b', 'f.md'), join(root, 'x', 'f.md'))
    rmSync(join(root, 'a', 'b'), { recursive: true })
    rmSync(join(root, 'a'), { recursive: true })

    const { certain, plan } = planRename(root, 'a/b', 'x')
    assert.equal(certain, true)
    applyRenamePlan(plan)
    // `../shared.md` still points at the root shared file — had extra.md been
    // treated as moved, the old-baseline rebase would have rewritten it to
    // `../a/shared.md`.
    assert.equal(readFileSync(join(root, 'x', 'extra.md'), 'utf8'), '[s](../shared.md)\n[into](f.md)\n')
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '[f](x/f.md)\n')
    assert.deepEqual(checkRepository(root), [])
  })

  // Case 8: partial residue — old still exists, so this is the ordinary
  // "newPath already exists" conflict, not post-hoc (safety valve).
  it('falls back to the existing conflict when the old path only partially disappeared', () => {
    const root = fixture({
      'docs/a.md': '# A\n',
      'docs/keep.md': '# Keep\n',
      'README.md': '[a](docs/a.md)\n',
    })
    mkdirSync(join(root, 'notes'))
    renameSync(join(root, 'docs', 'a.md'), join(root, 'notes', 'a.md'))

    const { certain, plan } = planRename(root, 'docs', 'notes')
    assert.equal(certain, false)
    assert.equal(plan.linkOnly, false)
    assert.match(plan.conflicts[0].reason, /already exists/)
  })

  // Case 9 (D3): no in-tool HEAD diff — an edited new file still repairs.
  it('repairs without verifying moved-content consistency', () => {
    const root = fixture({
      'a.md': '# A\n\n[home](README.md)\n',
      'README.md': '[a](a.md)\n',
    })
    mkdirSync(join(root, 'moved'))
    renameSync(join(root, 'a.md'), join(root, 'moved', 'guide.md'))
    writeFileSync(join(root, 'moved', 'guide.md'), '# A\n\n[home](README.md)\n\nEdited after move.\n')

    const { certain, plan } = planRename(root, 'a.md', 'moved/guide.md')
    assert.equal(certain, true)
    applyRenamePlan(plan)
    // The post-move edit survives; the out-link is still rebased around it.
    assert.equal(readFileSync(join(root, 'moved', 'guide.md'), 'utf8'), '# A\n\n[home](../README.md)\n\nEdited after move.\n')
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '[a](moved/guide.md)\n')
  })
})
