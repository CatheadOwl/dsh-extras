import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import { applyRenamePlan, planRename } from '../lib/links/index.js'
import { armGitTrace, disarmGitTrace, gitSpawnCounts, gitTraceTarget, totalSpawns } from './helpers/git-trace.mjs'

const roots = []
// Monotonic and never reset (see rename-posthoc.test.mjs): a reused tmp path
// would hit the lib's surviving gitTopLevel cache and hide the rev-parse spawn.
let fixtureSeq = 0

function fixture() {
  const root = join(tmpdir(), `dsh-md-links-spawn-count-${process.pid}-${fixtureSeq++}`)
  roots.push(root)
  mkdirSync(join(root, 'docs'), { recursive: true })
  // 12 in-link holders × 3 references each (36 in-links) plus out-links on the
  // moved file: the spawn budget must not grow with any of it (O(1), not O(N)).
  writeFileSync(join(root, 'docs', 'guide.md'), '# Guide\n\n[one](../shared.md)\n[two](../shared.md)\n[three](../shared.md)\n')
  writeFileSync(join(root, 'shared.md'), '# Shared\n')
  for (let i = 0; i < 12; i++) {
    writeFileSync(join(root, `holder-${i}.md`), `# H${i}\n[a](docs/guide.md)\n[b](docs/guide.md)\n[c](docs/guide.md)\n`)
  }
  spawnSync('git', ['init', '-q', root], { stdio: 'ignore' })
  spawnSync('git', ['-C', root, 'add', '-A'], { stdio: 'ignore' })
  return root
}

afterEach(() => {
  disarmGitTrace()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// F4 (raw-requirements F, spec git-data-plane §2/§3): one L1 rename call is a
// bounded, spawn-counted git data plane — N logical references collapse into
// a fixed number of subprocesses.
describe('git spawn budget (F4)', () => {
  it('one L1 rename call spawns O(1) git regardless of reference count', () => {
    const root = fixture()
    const target = gitTraceTarget(root)
    armGitTrace(target)

    const { certain, plan } = planRename(root, 'docs/guide.md', 'guide.md')
    assert.equal(certain, true)
    applyRenamePlan(plan)

    const counts = gitSpawnCounts(target)
    disarmGitTrace()
    assert.equal(counts.get('rev-parse'), 1) // gitTopLevel once, memoized for the rest of the call
    assert.equal(counts.get('grep'), 1) // one candidate sweep covers all 36 in-links
    assert.equal(counts.get('mv'), 1) // the move itself
    assert.equal(totalSpawns(counts), 3) // nothing else — no per-file / per-reference spawns
  })
})
