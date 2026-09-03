import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import {
  canonicalPath,
  checkRepository,
  collectMarkdownSources,
  documentAnchors,
  extractReferences,
  githubSlug,
  posixRelative,
  resolveReference,
  targetProbeCache,
} from '../lib/links/index.js'

const roots = []

function fixture(files) {
  const root = join(tmpdir(), `dsh-md-links-${process.pid}-${roots.length}`)
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

describe('extractReferences (AST, aligned)', () => {
  it('finds links, images, and definitions; ignores wikilinks and fenced code', () => {
    const refs = extractReferences(`
[inline](guide.md#Start)

![image](assets/a.png)

[manual]: docs/manual.md

[[note#Section]]

\`\`\`md
[fenced](missing.md)
\`\`\`
`)
    assert.deepEqual(refs.map(ref => [ref.kind, ref.url]), [
      ['link', 'guide.md#Start'],
      ['image', 'assets/a.png'],
      ['definition', 'docs/manual.md'],
    ])
  })

  it('locates the destination byte-exactly (offsets point at the raw url)', () => {
    const source = '[x](guide.md#Start)\n'
    const [ref] = extractReferences(source)
    assert.equal(source.slice(ref.start, ref.end), 'guide.md#Start')
  })

  it('extracts a bare-URL autolink without crashing (url resolves, no byte offsets)', () => {
    const refs = extractReferences('GUI at http://127.0.0.1:3080.\n')
    assert.deepEqual(refs.map(ref => [ref.kind, ref.url, ref.start]), [
      ['link', 'http://127.0.0.1:3080', undefined],
    ])
  })
})

describe('resolveReference (aligned)', () => {
  it('skips absolute, protocol-relative, and scheme targets', () => {
    const root = fixture({ 'README.md': '# Root\n', 'docs/a.md': '# A\n' })
    const sourceFile = join(root, 'README.md')
    const ref = url => ({ kind: 'link', line: 1, url, start: 0, end: url.length })
    for (const url of ['/abs.md', '//host/x.md', 'https://example.com/x.md', 'mailto:a@b.c']) {
      assert.deepEqual(resolveReference(ref(url), sourceFile, root), { ignored: true }, url)
    }
  })

  it('resolves a fragment on an empty path to the source file', () => {
    const root = fixture({ 'README.md': '# Root\n' })
    const sourceFile = join(root, 'README.md')
    const resolved = resolveReference({ kind: 'link', line: 1, url: '#frag', start: 0, end: 5 }, sourceFile, root)
    assert.equal(resolved.abs, sourceFile)
    assert.equal(resolved.fragment, 'frag')
  })

  it('resolves a document-relative target and keeps its fragment', () => {
    const root = fixture({ 'README.md': '# Root\n', 'docs/a.md': '# A\n' })
    const sourceFile = join(root, 'README.md')
    const resolved = resolveReference({ kind: 'link', line: 1, url: 'docs/a.md#A', start: 0, end: 10 }, sourceFile, root)
    assert.equal(resolved.abs, join(root, 'docs', 'a.md'))
    assert.equal(resolved.fragment, 'A')
  })
})

describe('checkRepository', () => {
  it('reports missing targets and anchors; skips external and absolute', () => {
    const root = fixture({
      'README.md': '[missing](no.md) [anchor](ok.md#Nope) [web](https://example.com/no.md) [abs](/no.md) [ok](ok.md#present)',
      'ok.md': '# Present\n',
    })
    assert.deepEqual(checkRepository(root).map(({ url, reason }) => [url, reason]), [
      ['no.md', 'target does not exist'],
      ['ok.md#Nope', 'anchor does not exist'],
    ])
  })

  it('reports the SpaceWar #13 stale fragment as anchor does not exist (CJK/μ/em dash)', () => {
    const root = fixture({
      'docs/eval/human-observation-log.md': [
        '### 13. 2026-09 — 基线脆弱与策略环境自适应（μ 扫描与自适应俯冲）',
        '',
        '[本册条目 13](#13-2026-09--基线脆弱策略不能自适应环境参数变化μ-扫描-自适应俯冲)',
        '',
      ].join('\n'),
    })
    const violations = checkRepository(root)
    assert.deepEqual(violations.map(({ url, reason }) => [url, reason]), [
      ['#13-2026-09--基线脆弱策略不能自适应环境参数变化μ-扫描-自适应俯冲', 'anchor does not exist'],
    ])
    assert.equal(violations[0].targetAbs.endsWith('human-observation-log.md'), true)
  })

  it('percent-decodes a CJK fragment before the anchor lookup (encoded links resolve)', () => {
    const root = fixture({
      'README.md': '[x](ok.md#%E5%9F%BA%E7%BA%BF)\n',
      'ok.md': '## 基线\n',
    })
    assert.deepEqual(checkRepository(root), [])
  })

  it('malformed %zz fragment stays raw and is reported anchor does not exist (fail-closed)', () => {
    const root = fixture({
      'README.md': '[x](ok.md#%zz)\n',
      'ok.md': '# Ok\n',
    })
    assert.deepEqual(checkRepository(root).map(({ url, reason }) => [url, reason]), [
      ['ok.md#%zz', 'anchor does not exist'],
    ])
  })

  it('collects tracked + untracked-not-ignored Markdown, not gitignored', () => {
    const root = fixture({
      '.gitignore': '.runs/\n',
      'README.md': '# Root\n',
      'docs/a.md': '# A\n',
      '.runs/obs.md': '[missing](no.md)\n',
    })
    writeFileSync(join(root, 'wip.md'), '# WIP\n')
    assert.deepEqual(collectMarkdownSources(root).map(file => posixRelative(root, file)), [
      'README.md',
      'docs/a.md',
      'wip.md',
    ])
  })

  it('does not scan submodule contents — a gitlink is not a Markdown source', () => {
    const root = fixture({ 'README.md': '# Root\n' })
    spawnSync('git', ['-C', root, 'update-index', '--add', '--cacheinfo', '160000,5496a20d5efb1d7f7a44a57a6eea1a99bea275ed,vendor/sub'], { stdio: 'ignore' })
    mkdirSync(join(root, 'vendor', 'sub'), { recursive: true })
    writeFileSync(join(root, 'vendor', 'sub', 'inner.md'), '[missing](no.md)\n')
    assert.deepEqual(collectMarkdownSources(root).map(file => posixRelative(root, file)), ['README.md'])
  })
})

describe('per-scan target probe cache', () => {
  it('probe and no-probe resolveReference agree on repeated and missing targets', () => {
    const root = fixture({
      'README.md': '# Root\n',
      'ok.md': '# Present\n',
    })
    const sourceFile = join(root, 'README.md')
    const ref = url => ({ kind: 'link', line: 1, url, start: 0, end: url.length })
    const probe = targetProbeCache()
    for (const url of ['ok.md#Present', 'ok.md#Nope', 'no.md', '#frag', 'ok.md']) {
      assert.deepEqual(
        resolveReference(ref(url), sourceFile, root, probe),
        resolveReference(ref(url), sourceFile, root),
        url,
      )
    }
  })

  it('checkRepository with repeated links matches the per-reference verdicts (5:1 dedup shape)', () => {
    const root = fixture({
      'a.md': '[x](t.md#h) [x](t.md#h) [x](t.md#Nope) [x](t.md#Nope) [x](t.md) [x](gone.md) [x](gone.md)\n',
      't.md': '# H\n',
    })
    assert.deepEqual(checkRepository(root).map(({ url, reason }) => [url, reason]), [
      ['t.md#Nope', 'anchor does not exist'],
      ['t.md#Nope', 'anchor does not exist'],
      ['gone.md', 'target does not exist'],
      ['gone.md', 'target does not exist'],
    ])
  })

  it('the cache is per-scan, never cross-scan: a file deleted after one scan is reported missing by the next', () => {
    const root = fixture({
      'README.md': '[x](t.md)\n',
      't.md': '# T\n',
    })
    assert.deepEqual(checkRepository(root), [])
    rmSync(join(root, 't.md'))
    assert.deepEqual(
      checkRepository(root).map(({ url, reason }) => [url, reason]),
      [['t.md', 'target does not exist']],
    )
  })

  it('the stale-negative direction: a file created after a missing verdict is clean on the next scan', () => {
    const root = fixture({
      'README.md': '[x](t.md)\n',
    })
    assert.deepEqual(
      checkRepository(root).map(({ url, reason }) => [url, reason]),
      [['t.md', 'target does not exist']],
    )
    writeFileSync(join(root, 't.md'), '# T\n')
    assert.deepEqual(checkRepository(root), [])
  })
})

describe('checkRepository include seam', () => {
  it('omitting options is byte-identical to an identity predicate', () => {
    const root = fixture({
      'README.md': '[missing](no.md) [anchor](ok.md#Nope) [web](https://example.com/no.md)',
      'ok.md': '# Present\n',
    })
    assert.deepEqual(checkRepository(root), checkRepository(root, { include: () => true }))
  })

  it('filters by canonical sourceFile', () => {
    const root = fixture({
      'a.md': '[missing](no.md)\n',
      'b.md': '[missing](other.md)\n',
    })
    const kept = checkRepository(root, { include: source => source.endsWith('a.md') })
    assert.deepEqual(kept.map(v => v.file), ['a.md'])
  })

  it('passes targetAbs for anchor-missing and undefined for a missing target', () => {
    const root = fixture({ 'a.md': '[anchor](ok.md#Nope) [gone](no.md)\n', 'ok.md': '# Present\n' })
    const seen = []
    checkRepository(root, { include: (source, target) => { seen.push([source.endsWith('a.md'), target]); return true } })
    assert.equal(seen.length, 2)
    assert.equal(seen[0][0], true)
    assert.equal(seen[0][1].endsWith('ok.md'), true)
    assert.equal(seen[1][1], undefined)
  })

  it('passes targetAbs undefined for an outside-repository target', () => {
    const name = `outside-${process.pid}-${roots.length}.md`
    const root = fixture({ 'a.md': `[x](../${name})\n` })
    const outside = join(root, '..', name)
    writeFileSync(outside, '# Outside\n')
    try {
      const seen = []
      checkRepository(root, { include: (source, target) => { seen.push(target); return true } })
      assert.equal(seen.length, 1)
      assert.equal(seen[0], undefined)
    } finally {
      rmSync(outside, { force: true })
    }
  })

  it('is deterministic across runs', () => {
    const root = fixture({ 'README.md': '[missing](no.md) [anchor](ok.md#Nope)', 'ok.md': '# Present\n' })
    const predicate = source => source.includes('README')
    assert.deepEqual(checkRepository(root, { include: predicate }), checkRepository(root, { include: predicate }))
  })
})

describe('canonicalPath', () => {
  it('resolves relative against base and unifies separators to /', () => {
    const base = join(tmpdir(), 'canonical-base')
    const expected = join(base, 'a.md').split('\\').join('/')
    const inputs = ['a.md', './a.md', 'a/../a.md', join(base, 'a.md')]
    if (sep === '\\') inputs.push('a\\..\\a.md')
    for (const raw of inputs) {
      assert.equal(canonicalPath(raw, base), expected, raw)
    }
  })
})

describe('anchors (forked, AST)', () => {
  it('matches GitHub slug rules, repeated-slug bumping, and explicit <a id>', () => {
    const anchors = documentAnchors('# Hello World\n## Repeat\n## Repeat\n<a id="stable"></a>\n')
    for (const anchor of ['hello-world', 'repeat', 'repeat-1', 'stable']) {
      assert.equal(anchors.has(anchor), true, anchor)
    }
    assert.equal(githubSlug('Showcase: web_fetch'), 'showcase-web_fetch')
  })
})
