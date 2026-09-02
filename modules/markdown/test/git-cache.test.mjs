import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import { gitTopLevel } from '../lib/links/index.js'
import { armGitTrace, disarmGitTrace, gitSpawnCounts, gitTraceTarget } from './helpers/git-trace.mjs'

const roots = []
// Monotonic and never reset (see rename-posthoc.test.mjs): a reused tmp path
// would hit the lib's surviving gitTopLevel cache and hide the rev-parse spawn.
let fixtureSeq = 0

function fixture() {
  const root = join(tmpdir(), `dsh-md-links-git-cache-${process.pid}-${fixtureSeq++}`)
  roots.push(root)
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'README.md'), '# Root\n')
  spawnSync('git', ['init', '-q', root], { stdio: 'ignore' })
  return root
}

afterEach(() => {
  disarmGitTrace()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// Spawn counts come from the GIT_TRACE counter (F4 helper), not from a
// `.git-moved` side-effect trick — "N logical calls = 1 spawn" is asserted
// directly (spec git-data-plane §4).
describe('gitTopLevel memoization', () => {
  it('returns the cached top-level without re-spawning git on a repeat call', () => {
    const root = fixture()
    const target = gitTraceTarget(root)
    armGitTrace(target)
    const topLevel = gitTopLevel(root)
    assert.equal(resolve(topLevel), resolve(root))
    assert.equal(gitTopLevel(root), topLevel)
    disarmGitTrace()
    assert.equal(gitSpawnCounts(target).get('rev-parse'), 1) // two logical calls, one spawn
  })

  it('reuses the cache for the canonical top-level after a subdirectory lookup', () => {
    const root = fixture()
    const sub = join(root, 'docs', 'sub')
    mkdirSync(sub, { recursive: true })
    writeFileSync(join(root, 'docs', 'sub', 'note.md'), '# Note\n')

    const target = gitTraceTarget(root)
    armGitTrace(target)
    const topLevel = gitTopLevel(sub)
    assert.equal(resolve(topLevel), resolve(root))
    // The canonical top-level was registered when resolving from `sub`; a later
    // call with the top-level itself must hit the cache, not spawn git again.
    assert.equal(gitTopLevel(root), topLevel)
    disarmGitTrace()
    assert.equal(gitSpawnCounts(target).get('rev-parse'), 1)
  })
})
