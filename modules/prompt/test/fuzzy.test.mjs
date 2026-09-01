import assert from 'node:assert/strict'
import { test } from 'node:test'

import { suggestPathCandidates } from '../lib/parse/fuzzy.js'

// Ported from CogGit's `pathHints.test.ts`, adapted for the prompt-parse
// return shape `{ matches, total }` and the two behavior changes: exact match
// is now a hit, and `cap` is a parameter (not a hardcoded 5).

test('suggests a path whose trailing segments match', () => {
  const candidates = [
    'coggit/src/core/watchPipeline.ts',
    'coggit/src/core/watchHost.ts',
    'other/main.ts',
  ]
  assert.deepEqual(suggestPathCandidates(candidates, 'src/core/watchPipeline.ts'), {
    matches: ['coggit/src/core/watchPipeline.ts'],
    total: 1,
  })
})

test('collects trailing-segment matches in input order; exact is now a hit', () => {
  const candidates = ['a/b/c.ts', 'x/a/b/c.ts', 'y/a/b/c.ts', 'z/a/b/c.ts', 'w/a/b/c.ts', 'v/a/b/c.ts']
  const result = suggestPathCandidates(candidates, 'a/b/c.ts')
  // Exact `a/b/c.ts` now leads; cap 5 keeps the first five, total counts all six.
  assert.deepEqual(result, {
    matches: ['a/b/c.ts', 'x/a/b/c.ts', 'y/a/b/c.ts', 'z/a/b/c.ts', 'w/a/b/c.ts'],
    total: 6,
  })
})

test('includes the exact match as a hit', () => {
  assert.deepEqual(suggestPathCandidates(['coggit/src/core/watchPipeline.ts'], 'coggit/src/core/watchPipeline.ts'), {
    matches: ['coggit/src/core/watchPipeline.ts'],
    total: 1,
  })
})

test('returns empty when nothing matches', () => {
  assert.deepEqual(suggestPathCandidates(['coggit/src/main.ts'], 'coggit/src/core/watchPipeline.ts'), {
    matches: [],
    total: 0,
  })
})

test('skips empty or root queries', () => {
  assert.deepEqual(suggestPathCandidates(['a.ts', 'b.ts'], ''), { matches: [], total: 0 })
  assert.deepEqual(suggestPathCandidates(['a.ts', 'b.ts'], '.'), { matches: [], total: 0 })
})

test('de-duplicates repeated candidate hits', () => {
  assert.deepEqual(suggestPathCandidates(['a/x/y.ts', 'a/x/y.ts', 'b/x/y.ts'], 'x/y.ts'), {
    matches: ['a/x/y.ts', 'b/x/y.ts'],
    total: 2,
  })
})

test('matches a leaf after stripping the file extension', () => {
  assert.deepEqual(suggestPathCandidates(['coggit/src/registry.ts', 'coggit/src/other.ts'], 'registry'), {
    matches: ['coggit/src/registry.ts'],
    total: 1,
  })
})

test('matches a multi-segment query when only the leaf extension is missing', () => {
  assert.deepEqual(suggestPathCandidates(['coggit/src/config/manifest.ts', 'coggit/src/scope.ts'], 'src/config/manifest'), {
    matches: ['coggit/src/config/manifest.ts'],
    total: 1,
  })
})

test('matches a markdown leaf when the query omits the extension', () => {
  assert.deepEqual(suggestPathCandidates(['coggit/README.md', 'coggit/package.json'], 'coggit/README'), {
    matches: ['coggit/README.md'],
    total: 1,
  })
})

test('exact leaf query matches through trailing segments', () => {
  assert.deepEqual(suggestPathCandidates(['coggit/src/registry.ts'], 'registry.ts'), {
    matches: ['coggit/src/registry.ts'],
    total: 1,
  })
})

test('does not strip-match a query against a mismatched leaf', () => {
  assert.equal(suggestPathCandidates(['coggit/src/registry.ts', 'coggit/src/capabilities'], 'registry.ts.md').total, 0)
  assert.equal(suggestPathCandidates(['coggit/src/registry.ts'], 'registryx').total, 0)
  assert.equal(suggestPathCandidates(['coggit/src/registry.ts'], 'registry.md').total, 0)
})

test('does not strip-match an extensioned query against a doubly-suffixed leaf', () => {
  assert.equal(suggestPathCandidates(['src/registry.ts.md'], 'registry.ts').total, 0)
  assert.equal(suggestPathCandidates(['src/registry.ts.md'], 'src/registry.ts').total, 0)
})

test('does not strip-match a hidden-file query against a suffixed hidden leaf', () => {
  assert.equal(suggestPathCandidates(['src/.gitignore.bak'], '.gitignore').total, 0)
})

test('does not suggest a hidden candidate for a plain leaf query', () => {
  assert.deepEqual(suggestPathCandidates(['src/.gitignore', 'src/gitignore.ts'], 'gitignore'), {
    matches: ['src/gitignore.ts'],
    total: 1,
  })
})

// --- prompt-parse adaptations: cap parameter, directory candidates, total ---

test('matches a bare directory name at any depth', () => {
  const candidates = ['handbooks', 'topics/handbooks', 'a/b/handbooks', 'handbooks.md', 'other/readme.md']
  const result = suggestPathCandidates(candidates, 'handbooks')
  // Dotless query strips the extension, so `handbooks.md` also matches
  // (documented side effect; the consumer filters by kind for strict dirs).
  assert.deepEqual(result, {
    matches: ['handbooks', 'topics/handbooks', 'a/b/handbooks', 'handbooks.md'],
    total: 4,
  })
})

test('matches a `./`-prefixed candidate from a bare directory query', () => {
  // The leading `./` on the CANDIDATE side is just a directory prefix, so a
  // bare `handbooks` query hits `./handbooks` as a trailing-segment match.
  assert.deepEqual(suggestPathCandidates(['./handbooks'], 'handbooks', 1), {
    matches: ['./handbooks'],
    total: 1,
  })
  assert.deepEqual(suggestPathCandidates(['./topics/handbooks'], 'handbooks'), {
    matches: ['./topics/handbooks'],
    total: 1,
  })
})

test('cap truncates matches but total still reports the ambiguity', () => {
  const candidates = ['x/handbooks', 'y/handbooks', 'z/handbooks']
  assert.deepEqual(suggestPathCandidates(candidates, 'handbooks', 1), {
    matches: ['x/handbooks'],
    total: 3,
  })
})

test('cap=0 returns no matches but still counts total', () => {
  assert.deepEqual(suggestPathCandidates(['x/handbooks', 'y/handbooks'], 'handbooks', 0), {
    matches: [],
    total: 2,
  })
})

test('negative cap clamps to zero matches but still counts total', () => {
  assert.deepEqual(suggestPathCandidates(['x/handbooks', 'y/handbooks'], 'handbooks', -1), {
    matches: [],
    total: 2,
  })
})

test('matches trailing-slash directory candidates', () => {
  const candidates = ['handbooks/', 'topics/handbooks/', 'a/b/handbooks/']
  assert.deepEqual(suggestPathCandidates(candidates, 'handbooks'), {
    matches: ['handbooks/', 'topics/handbooks/', 'a/b/handbooks/'],
    total: 3,
  })
})

test('preserves a leading `./` in the query (no fuzzy strip)', () => {
  // Normalization keeps `./`; segment matching treats it as a real segment, so
  // `./handbooks` does not match `handbooks`. Callers strip `./` themselves.
  assert.deepEqual(suggestPathCandidates(['handbooks', 'topics/handbooks'], './handbooks'), {
    matches: [],
    total: 0,
  })
})

test('normalized backslash query matches slash-separated candidates', () => {
  // parse.ts normalizes `\` → `/`; fuzzy sees the slash form.
  assert.deepEqual(suggestPathCandidates(['handbooks/dsh-hooks'], 'handbooks/dsh-hooks'), {
    matches: ['handbooks/dsh-hooks'],
    total: 1,
  })
})

// --- root-anchored queries (repository-root-relative `/` citations) ---

test('root-anchored query matches only the exact root position', () => {
  const candidates = ['handbooks/', 'topics/handbooks/', 'a/b/handbooks/']
  assert.deepEqual(suggestPathCandidates(candidates, '/handbooks'), {
    matches: ['handbooks/'],
    total: 1,
  })
})

test('root-anchored query never tail-matches deeper positions', () => {
  const candidates = ['workunits/md-fabric/', 'dsh-plugin-dev/md-fabric/']
  // `/md-fabric` names the root node `md-fabric`; no such root position exists.
  assert.deepEqual(suggestPathCandidates(candidates, '/md-fabric'), { matches: [], total: 0 })
  assert.deepEqual(suggestPathCandidates(candidates, '/workunits/md-fabric'), {
    matches: ['workunits/md-fabric/'],
    total: 1,
  })
})

test('root-anchored query pins a full citation to the exact file', () => {
  const candidates = ['a/b/README.md', 'README.md']
  assert.deepEqual(suggestPathCandidates(candidates, '/README.md'), {
    matches: ['README.md'],
    total: 1,
  })
})

test('root-anchored query does not extension-strip', () => {
  // The citation form requires the full name: `/docs` names root node `docs`,
  // not the file `docs.md`; `/README.md` does not fall back to `README`.
  assert.equal(suggestPathCandidates(['docs.md'], '/docs').total, 0)
  assert.equal(suggestPathCandidates(['README'], '/README.md').total, 0)
})

test('root-anchored query matches a `/`-prefixed candidate at the same position', () => {
  assert.deepEqual(suggestPathCandidates(['/workunits/md-fabric/'], '/workunits/md-fabric'), {
    matches: ['/workunits/md-fabric/'],
    total: 1,
  })
})
