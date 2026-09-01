import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolvePromptPaths } from '../lib/parse/resolve.js'

// Directory candidates carry a trailing slash (the dir-specifier convention);
// files do not. Ordered so the dir precedes its same-named file where relevant.
const tree = [
  'handbooks/',                                          // dir, depth 1
  'handbooks.md',                                        // file, depth 1 (ext-strip side effect)
  'dsh-plugin-dev/gates/',                               // dir, depth 2
  'dsh-plugin-dev/gates/src/register.ts',                // file, depth 4
  'workunits/prompt-parse/spec/path-extraction-scope.md', // file, depth 3
  'README.md',                                           // file, depth 1
  'handbooks/README.md',                                 // file, depth 2
  'handbooks/deep/README.md',                            // file, depth 3
]

test('bare word matches only within maxDepth (default 2)', () => {
  const r = resolvePromptPaths('gates', tree)
  assert.equal(r.length, 1)
  assert.equal(r[0].candidate.kind, 'bare')
  assert.equal(r[0].total, 1)
  assert.deepEqual(r[0].resolved, ['dsh-plugin-dev/gates/'])
})

test('strong specifier matches the full tree regardless of depth', () => {
  const r = resolvePromptPaths('spec/path-extraction-scope.md', tree)
  assert.equal(r[0].candidate.kind, 'file')
  assert.equal(r[0].total, 1)
  assert.deepEqual(r[0].resolved, ['workunits/prompt-parse/spec/path-extraction-scope.md'])
})

test('trailing slash is a dir specifier (matches directory candidates only)', () => {
  const r = resolvePromptPaths('handbooks/', tree)
  assert.equal(r[0].candidate.kind, 'dir')
  assert.equal(r[0].candidate.normalized, 'handbooks')
  assert.equal(r[0].total, 1)
  assert.deepEqual(r[0].resolved, ['handbooks/'])
})

test('bare directory name also matches a same-named file (ext-strip side effect)', () => {
  const r = resolvePromptPaths('handbooks', tree)
  assert.equal(r[0].candidate.kind, 'bare')
  assert.equal(r[0].total, 2) // handbooks/ + handbooks.md
  assert.deepEqual(r[0].resolved, ['handbooks/']) // exact leaf beats ext-stripped
})

test('drops an ambiguous mention once total reaches the threshold', () => {
  const many = ['a/README.md', 'b/README.md', 'c/README.md', 'd/README.md', 'e/README.md', 'f/README.md']
  const dropped = resolvePromptPaths('README', many)
  assert.equal(dropped[0].total, 6)
  assert.deepEqual(dropped[0].resolved, []) // 6 >= 5 → drop

  const kept = resolvePromptPaths('README', many, { ambiguityThreshold: 10 })
  assert.equal(kept[0].total, 6)
  // All six tie on leaf-exactness + depth, so the whole top tier resolves —
  // and it is cap-independent: default cap 5 truncates `matches` but not `resolved`.
  assert.deepEqual(kept[0].matches, ['a/README.md', 'b/README.md', 'c/README.md', 'd/README.md', 'e/README.md'])
  assert.deepEqual(kept[0].resolved, many) // 6 < 10 → whole top tier
})

test('keeps the mention but resolves empty when nothing matches', () => {
  const r = resolvePromptPaths('zzz-not-a-path', tree)
  assert.equal(r.length, 1)
  assert.equal(r[0].total, 0)
  assert.deepEqual(r[0].resolved, [])
})

test('maxDepth is tunable per call', () => {
  const r = resolvePromptPaths('README', tree, { maxDepth: 1 })
  assert.equal(r[0].total, 1) // only README.md at depth 1
  assert.deepEqual(r[0].resolved, ['README.md'])
})

test('composes a full prompt into resolved mentions', () => {
  const r = resolvePromptPaths('打开 handbooks 里的 gates 文档', tree)
  assert.equal(r.length, 5)
  const resolved = r.filter((m) => m.resolved.length > 0)
    .map((m) => [m.candidate.normalized, m.resolved])
  assert.deepEqual(resolved, [
    ['handbooks', ['handbooks/']],
    ['gates', ['dsh-plugin-dev/gates/']],
  ])
})

test('leading ./ on a dir specifier still resolves', () => {
  const r = resolvePromptPaths('./handbooks/', tree)
  assert.equal(r[0].candidate.kind, 'dir')
  assert.equal(r[0].candidate.normalized, 'handbooks')
  assert.deepEqual(r[0].resolved, ['handbooks/'])
})

test('cap=0 still resolves the top tier but returns empty matches', () => {
  const r = resolvePromptPaths('handbooks', ['handbooks/', 'handbooks.md'], { cap: 0 })
  assert.equal(r[0].total, 2)
  assert.deepEqual(r[0].matches, [])
  assert.deepEqual(r[0].resolved, ['handbooks/'])
})

test('ranks shallow among exact matches (bare docs → root docs/, not deepseek-harness/docs/)', () => {
  const docsTree = [
    'deepseek-harness/docs/', // depth 2, listed first
    'docs/',                  // depth 1, listed second
  ]
  const r = resolvePromptPaths('docs', docsTree)
  assert.equal(r[0].total, 2)
  assert.deepEqual(r[0].matches, ['docs/', 'deepseek-harness/docs/'])
  assert.deepEqual(r[0].resolved, ['docs/']) // depth separates: only the shallow root
})

test('ranks exact leaf-name above an extension-stripped match (gates → dir, not gates.yml)', () => {
  const t = ['gates.yml', 'dsh-plugin-dev/gates/'] // gates.yml is shallower (depth 1) but ext-stripped
  const r = resolvePromptPaths('gates', t)
  assert.equal(r[0].total, 2)
  assert.deepEqual(r[0].matches, ['dsh-plugin-dev/gates/', 'gates.yml'])
  assert.deepEqual(r[0].resolved, ['dsh-plugin-dev/gates/'])
})

test('matches ranked by depth, ties keep input order', () => {
  const t = ['a/b/c.md', 'c.md', 'x/y/c.md', 'p/c.md']
  const r = resolvePromptPaths('c.md', t)
  assert.equal(r[0].total, 4)
  assert.deepEqual(r[0].matches, ['c.md', 'p/c.md', 'a/b/c.md', 'x/y/c.md'])
  assert.deepEqual(r[0].resolved, ['c.md']) // depth 1 is strictly shallower
})

test('cap truncates after ranking (most relevant survive, not first-in-input)', () => {
  const t = ['a/b/c.md', 'c.md', 'x/y/c.md', 'p/c.md']
  const r = resolvePromptPaths('c.md', t, { cap: 2 })
  assert.equal(r[0].total, 4)
  assert.deepEqual(r[0].matches, ['c.md', 'p/c.md'])
  assert.deepEqual(r[0].resolved, ['c.md'])
})

test('de-duplicates candidatePaths once (duplicate does not inflate total)', () => {
  const r = resolvePromptPaths('handbooks', ['handbooks/', 'handbooks/', 'handbooks.md'])
  assert.equal(r[0].total, 2) // handbooks/ + handbooks.md, not 3
  assert.deepEqual(r[0].matches, ['handbooks/', 'handbooks.md'])
  assert.deepEqual(r[0].resolved, ['handbooks/'])
})

test('resolves the whole top tier when leaf-name and depth tie (no input-order winner)', () => {
  const t = ['dsh-plugin-dev/md-fabric/', 'workunits/md-fabric/']
  const r = resolvePromptPaths('md-fabric', t)
  assert.equal(r[0].total, 2)
  assert.deepEqual(r[0].matches, ['dsh-plugin-dev/md-fabric/', 'workunits/md-fabric/'])
  assert.deepEqual(r[0].resolved, ['dsh-plugin-dev/md-fabric/', 'workunits/md-fabric/'])
})

test('top tier is cap-independent (cap=1 still resolves both tied paths)', () => {
  const t = ['dsh-plugin-dev/md-fabric/', 'workunits/md-fabric/']
  const r = resolvePromptPaths('md-fabric', t, { cap: 1 })
  assert.deepEqual(r[0].matches, ['dsh-plugin-dev/md-fabric/'])
  assert.deepEqual(r[0].resolved, ['dsh-plugin-dev/md-fabric/', 'workunits/md-fabric/'])
})

test('top tier excludes a deeper same-exact sibling (depth separates)', () => {
  const t = ['a/b/c.md', 'p/c.md', 'q/c.md']
  const r = resolvePromptPaths('c.md', t)
  assert.equal(r[0].total, 3)
  assert.deepEqual(r[0].matches, ['p/c.md', 'q/c.md', 'a/b/c.md'])
  assert.deepEqual(r[0].resolved, ['p/c.md', 'q/c.md']) // depth-2 tie; the depth-3 exact sibling is excluded
})

// --- root-anchored citations (repository-root-relative `/` form) ---

test('root-anchored citation resolves the exact root position (bare-ambiguous name rescued)', () => {
  const many = ['README.md', 'a/README.md', 'b/README.md', 'c/README.md', 'd/README.md', 'e/README.md']
  // The bare word `README` is dropped at the default threshold; the rooted
  // citation `/README.md` pins the root file exactly.
  assert.deepEqual(resolvePromptPaths('README', many)[0].resolved, [])
  const r = resolvePromptPaths('/README.md', many)
  assert.equal(r[0].candidate.kind, 'file')
  assert.equal(r[0].total, 1)
  assert.deepEqual(r[0].resolved, ['README.md'])
})

test('root-anchored citation matches only the root position, not a deeper same-name dir', () => {
  const t = ['docs/', 'deepseek-harness/docs/']
  const r = resolvePromptPaths('/docs', t)
  assert.equal(r[0].total, 1)
  assert.deepEqual(r[0].resolved, ['docs/'])
})

test('root-anchored citation of a deep dir resolves exactly (slash and dir variants)', () => {
  const t = ['workunits/md-fabric/', 'dsh-plugin-dev/md-fabric/']
  assert.deepEqual(resolvePromptPaths('/workunits/md-fabric', t)[0].resolved, ['workunits/md-fabric/'])
  assert.deepEqual(resolvePromptPaths('/workunits/md-fabric/', t)[0].resolved, ['workunits/md-fabric/'])
})

test('root-anchored citation naming no root position stays 0-hit', () => {
  const t = ['workunits/md-fabric/', 'dsh-plugin-dev/md-fabric/']
  const r = resolvePromptPaths('/md-fabric', t)
  assert.equal(r[0].candidate.kind, 'path')
  assert.equal(r[0].total, 0)
  assert.deepEqual(r[0].resolved, [])
})

test('root-anchored citation of a full deep file resolves exactly', () => {
  const r = resolvePromptPaths('/workunits/prompt-parse/spec/path-extraction-scope.md', tree)
  assert.equal(r[0].candidate.kind, 'file')
  assert.equal(r[0].total, 1)
  assert.deepEqual(r[0].resolved, ['workunits/prompt-parse/spec/path-extraction-scope.md'])
})

// --- workspace-citation (`@`-prefixed) references ---
// `@` canonicalizes to the same root anchor as `/`, so resolution semantics
// are identical: exact full position, no tail match, no extension stripping.

test('@ citation resolves the exact root position (bare-ambiguous name rescued)', () => {
  const many = ['README.md', 'a/README.md', 'b/README.md', 'c/README.md', 'd/README.md', 'e/README.md']
  assert.deepEqual(resolvePromptPaths('README', many)[0].resolved, [])
  const r = resolvePromptPaths('@README.md', many)
  assert.equal(r[0].candidate.kind, 'file')
  assert.equal(r[0].total, 1)
  assert.deepEqual(r[0].resolved, ['README.md'])
})

test('@ citation matches only the root position, not a deeper same-name dir', () => {
  const t = ['docs/', 'deepseek-harness/docs/']
  const r = resolvePromptPaths('@docs', t)
  assert.equal(r[0].total, 1)
  assert.deepEqual(r[0].resolved, ['docs/'])
})

test('@ citation of a deep dir resolves exactly (slash and dir variants)', () => {
  const t = ['workunits/md-fabric/', 'dsh-plugin-dev/md-fabric/']
  assert.deepEqual(resolvePromptPaths('@workunits/md-fabric', t)[0].resolved, ['workunits/md-fabric/'])
  assert.deepEqual(resolvePromptPaths('@workunits/md-fabric/', t)[0].resolved, ['workunits/md-fabric/'])
})

test('@ citation naming no root position stays 0-hit', () => {
  const t = ['workunits/md-fabric/', 'dsh-plugin-dev/md-fabric/']
  const r = resolvePromptPaths('@md-fabric', t)
  assert.equal(r[0].candidate.kind, 'path')
  assert.equal(r[0].total, 0)
  assert.deepEqual(r[0].resolved, [])
})

test('@ citation of a full deep file resolves exactly', () => {
  const r = resolvePromptPaths('@workunits/prompt-parse/spec/path-extraction-scope.md', tree)
  assert.equal(r[0].candidate.kind, 'file')
  assert.equal(r[0].total, 1)
  assert.deepEqual(r[0].resolved, ['workunits/prompt-parse/spec/path-extraction-scope.md'])
})
