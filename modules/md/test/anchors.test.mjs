import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { anchorCache, documentAnchorPairs, documentAnchors, githubSlug } from '../lib/links/index.js'

test('githubSlug matches GitHub heading-slug rules', () => {
  assert.equal(githubSlug('Showcase: web_fetch'), 'showcase-web_fetch')
  assert.equal(githubSlug('Hello world'), 'hello-world')
  assert.equal(githubSlug('UPPER Case'), 'upper-case')
})

test('documentAnchors exposes heading slugs and explicit <a id>', () => {
  const source = '# One\n\n## Two **bold**\n\n<a id="explicit"></a>\n'
  const anchors = documentAnchors(source)
  assert.ok(anchors.has('one'))
  assert.ok(anchors.has('two-bold'))
  assert.ok(anchors.has('explicit'))
})

test('documentAnchors bumps repeated slugs GitHub-style', () => {
  const source = '# Repeat\n\n# Repeat\n\n# Repeat\n'
  const anchors = documentAnchors(source)
  assert.ok(anchors.has('repeat'))
  assert.ok(anchors.has('repeat-1'))
  assert.ok(anchors.has('repeat-2'))
})

test('anchorCache memoizes per file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-links-'))
  try {
    const file = join(dir, 'a.md')
    writeFileSync(file, '# Cache Me\n')
    const anchorsOf = anchorCache()
    const first = anchorsOf(file)
    const second = anchorsOf(file)
    assert.equal(first, second)
    assert.ok(first.has('cache-me'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('githubSlug keeps CJK and μ, drops full-width parens, and turns a spaced em dash into two hyphens (SpaceWar #13)', () => {
  // The em dash is stripped but its two flanking spaces survive, each becoming
  // a hyphen — the `--` after `2026-09` is by design (upstream asserts the
  // same for `Live events — mode!`).
  assert.equal(
    githubSlug('13. 2026-09 — 基线脆弱与策略环境自适应（μ 扫描与自适应俯冲）'),
    '13-2026-09--基线脆弱与策略环境自适应μ-扫描与自适应俯冲',
  )
  // The stale-title slug reported verbatim by the doc-link gate in SpaceWar.
  assert.equal(
    githubSlug('13. 2026-09 — 基线脆弱策略不能自适应环境参数变化（μ 扫描 自适应俯冲）'),
    '13-2026-09--基线脆弱策略不能自适应环境参数变化μ-扫描-自适应俯冲',
  )
})

test('githubSlug: spaced em dash leaves two hyphens (mirrors the upstream assertion)', () => {
  assert.equal(githubSlug('Live events — mode!'), 'live-events--mode')
})

test('documentAnchors exposes the CJK/μ/em-dash heading slug (SpaceWar #13)', () => {
  const source = '### 13. 2026-09 — 基线脆弱与策略环境自适应（μ 扫描与自适应俯冲）\n'
  assert.ok(documentAnchors(source).has('13-2026-09--基线脆弱与策略环境自适应μ-扫描与自适应俯冲'))
})

test('documentAnchorPairs pairs each heading with its exact anchor, bump-suffixed on repeats', () => {
  const source = '# Repeat\n\n# Repeat\n\n# Other\n'
  assert.deepEqual(documentAnchorPairs(source).map(pair => [pair.heading.text, pair.anchor]), [
    ['Repeat', 'repeat'],
    ['Repeat', 'repeat-1'],
    ['Other', 'other'],
  ])
})

test('documentAnchorPairs: every pair anchor is a real documentAnchors member, even with an <a id> colliding on a bump suffix', () => {
  const source = '# Repeat\n\n# Repeat\n\n<a id="repeat-1"></a>\n\n# Other\n'
  const anchors = documentAnchors(source)
  const pairs = documentAnchorPairs(source)
  for (const pair of pairs) {
    assert.ok(anchors.has(pair.anchor), `${pair.anchor} must be a real anchor`)
  }
  assert.deepEqual(pairs.map(pair => [pair.heading.text, pair.anchor]), [
    ['Repeat', 'repeat'],
    ['Repeat', 'repeat-1'],
    ['Other', 'other'],
  ])
})
