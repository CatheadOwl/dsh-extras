// Plugin-surface tests for md-links-gates: the doc-link gate check (shape
// adaptation + turn-end attribution predicate over the md-links data plane;
// cases ported from the archived scripts/doc-link-lib.test.mjs) and the
// registerGate wiring with a soft-inject stub ctx.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import { check } from '../lib/gate-check.js'
import { apply } from '../lib/index.js'

const roots = []

function fixture(files) {
  const root = join(tmpdir(), `dsh-md-links-gates-${process.pid}-${roots.length}`)
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

describe('doc-link gate check', () => {
  it('manual (no changes) maps all md-links violations into the GateViolation shape', () => {
    const root = fixture({ 'README.md': '[missing](no.md)\n' })
    const violations = check(root)
    assert.equal(violations.length, 1)
    assert.equal(violations[0].file, 'README.md')
    assert.equal(violations[0].line, 1)
    assert.match(violations[0].reason, /unresolved Markdown reference "no\.md" \(target does not exist\)/)
    assert.equal(violations[0].remedy.kind, 'manual')
  })

  it('passes a repository with no broken references', () => {
    const root = fixture({
      'README.md': '[ok](ok.md)\n',
      'ok.md': '# Ok\n',
    })
    assert.deepEqual(check(root), [])
  })

  it('skips external targets (//, /, scheme)', () => {
    const root = fixture({
      'a.md': '[ext](https://example.com/x)\n[site](/root.md)\n[proto](//cdn.example/y)\n',
      'b.md': '# B\n',
    })
    assert.deepEqual(check(root), [])
  })

  it('stop 档：精确写 source → 只保留该源文件的违规', () => {
    const root = fixture({
      'a.md': '[missing](no.md)\n',
      'b.md': '[missing](other.md)\n',
    })
    const violations = check(root, { paths: ['a.md'], opaque: false })
    assert.deepEqual(violations.map(v => v.file), ['a.md'])
  })

  it('stop 档：精确写 target → 保留入向锚点断裂（改标题断别处 #fragment）', () => {
    const root = fixture({
      'a.md': '[x](b.md#old-anchor)\n',
      'b.md': '# Old news\n',
    })
    const violations = check(root, { paths: ['b.md'], opaque: false })
    assert.deepEqual(violations.map(v => v.file), ['a.md'])
    assert.ok(violations[0].remedy.guidance.includes('"Old news" → #old-news'), 'hint lists the target file heading, not the source file')
  })

  it('stop 档：opaque → 全算', () => {
    const root = fixture({
      'a.md': '[missing](no.md)\n',
      'b.md': '[missing](other.md)\n',
    })
    const violations = check(root, { paths: [], opaque: true })
    assert.deepEqual(violations.map(v => v.file).sort(), ['a.md', 'b.md'])
  })

  it('stop 档：非归责（平行会话中间态）→ 丢弃', () => {
    const root = fixture({ 'a.md': '[missing](no.md)\n' })
    const violations = check(root, { paths: ['unrelated.md'], opaque: false })
    assert.deepEqual(violations, [])
  })

  it('stop 档：空写集合且非 opaque → 全弃', () => {
    const root = fixture({ 'a.md': '[missing](no.md)\n' })
    assert.deepEqual(check(root, { paths: [], opaque: false }), [])
  })

  it('路径归一：相对 / ./ / ../ / 绝对路径 → 同一归责键', () => {
    const root = fixture({ 'a.md': '[missing](no.md)\n' })
    const absolute = join(root, 'a.md')
    for (const raw of ['a.md', './a.md', 'a/../a.md', absolute]) {
      const violations = check(root, { paths: [raw], opaque: false })
      assert.equal(violations.length, 1, raw)
      assert.equal(violations[0].file, 'a.md', raw)
    }
  })

  it('复现 SpaceWar #13：em dash 标题 + 旧文本引用 → 逐字报 anchor does not exist', () => {
    const root = fixture({
      'docs/eval/human-observation-log.md': [
        '### 13. 2026-09 — 基线脆弱与策略环境自适应（μ 扫描与自适应俯冲）',
        '',
        '引用一：[本册条目 13](#13-2026-09--基线脆弱策略不能自适应环境参数变化μ-扫描-自适应俯冲)',
        '引用二：[条目 13](#13-2026-09--基线脆弱策略不能自适应环境参数变化μ-扫描-自适应俯冲)',
        '',
      ].join('\n'),
    })
    const violations = check(root)
    assert.equal(violations.length, 2)
    assert.equal(violations[0].line, 3)
    assert.equal(violations[1].line, 4)
    for (const violation of violations) {
      assert.equal(violation.file, 'docs/eval/human-observation-log.md')
      assert.equal(
        violation.reason,
        'unresolved Markdown reference "#13-2026-09--基线脆弱策略不能自适应环境参数变化μ-扫描-自适应俯冲" (anchor does not exist)',
      )
      assert.equal(violation.remedy.kind, 'manual')
      assert.ok(
        violation.remedy.guidance.includes('"13. 2026-09 — 基线脆弱与策略环境自适应（μ 扫描与自适应俯冲）" → #13-2026-09--基线脆弱与策略环境自适应μ-扫描与自适应俯冲'),
        'remedy guidance carries the heading → exact anchor hint',
      )
      assert.ok(
        !violation.remedy.guidance.includes('基线脆弱策略不能自适应环境参数变化'),
        'remedy guidance does not echo the broken fragment',
      )
    }
  })

  it('修复后：fragment 换成新标题的 slug → 通过', () => {
    const root = fixture({
      'docs/eval/human-observation-log.md': [
        '### 13. 2026-09 — 基线脆弱与策略环境自适应（μ 扫描与自适应俯冲）',
        '',
        '[本册条目 13](#13-2026-09--基线脆弱与策略环境自适应μ-扫描与自适应俯冲)',
        '',
      ].join('\n'),
    })
    assert.deepEqual(check(root), [])
  })

  it('hint 平局时按文档顺序列出多个候选标题（确定性）', () => {
    const root = fixture({
      'README.md': [
        '## 13. 2026-09 — 基线脆弱（μ 扫描与自适应俯冲）',
        '## 13. 2026-09 — 基线脆弱（μ 扫描与规避）',
        '',
        '[x](#13-2026-09--基线脆弱策略不能自适应环境参数变化μ-扫描-自适应俯冲)',
        '',
      ].join('\n'),
    })
    const [violation] = check(root)
    const guidance = violation.remedy.guidance
    const first = guidance.indexOf('13. 2026-09 — 基线脆弱（μ 扫描与自适应俯冲）')
    const second = guidance.indexOf('13. 2026-09 — 基线脆弱（μ 扫描与规避）')
    assert.ok(first !== -1 && second !== -1, 'both tie-scoring headings are hinted')
    assert.ok(first < second, 'hints are in document order')
  })

  it('hint 按 LCP 长度排序：共享前缀更长的标题排前面（排序主键）', () => {
    const root = fixture({
      'README.md': [
        '## 13. 2026-09 — 完全无关内容',
        '## 13. 2026-09 — 基线脆弱（μ 扫描与自适应俯冲）',
        '',
        '[x](#13-2026-09--基线脆弱策略不能自适应环境参数变化μ-扫描-自适应俯冲)',
        '',
      ].join('\n'),
    })
    const [violation] = check(root)
    const guidance = violation.remedy.guidance
    const short = guidance.indexOf('13. 2026-09 — 完全无关内容')
    const long = guidance.indexOf('13. 2026-09 — 基线脆弱（μ 扫描与自适应俯冲）')
    assert.ok(short !== -1 && long !== -1, 'both prefix-sharing headings are hinted')
    assert.ok(long < short, 'the longer-LCP heading ranks first')
  })

  it('percent-encoded fragment：hint 先解码再排序（与 lib 解码对齐）', () => {
    const stale = '13-2026-09--基线脆弱策略不能自适应环境参数变化μ-扫描-自适应俯冲'
    const encoded = `#${encodeURIComponent(stale)}`
    const root = fixture({
      'README.md': [
        '### 13. 2026-09 — 基线脆弱与策略环境自适应（μ 扫描与自适应俯冲）',
        '',
        `[x](${encoded})`,
        '',
      ].join('\n'),
    })
    const [violation] = check(root)
    assert.equal(violation.reason, `unresolved Markdown reference ${JSON.stringify(encoded)} (anchor does not exist)`)
    assert.ok(
      violation.remedy.guidance.includes('#13-2026-09--基线脆弱与策略环境自适应μ-扫描与自适应俯冲'),
      'hint decodes the fragment before ranking',
    )
  })
})

describe('plugin registration', () => {
  it('apply registers the doc-link gate through the soft-inject seam and returns the disposer', () => {
    const defs = []
    const tools = []
    const ctx = {
      tools: { register(def) { tools.push(def) } },
      inject(names, cb) {
        if (names.includes('gates')) {
          const disposer = cb({ gates: { register(def) { defs.push(def); return () => {} } } })
          assert.equal(typeof disposer, 'function', 'register disposer must be returned')
        }
      },
    }
    apply(ctx)
    // Merged md fiber: the tool and both gates register together.
    assert.equal(tools.length, 1)
    assert.equal(tools[0].name, 'md_rename')
    assert.equal(defs.length, 2)
    const gate = defs.find(def => def.id === 'doc-link')
    assert.equal(gate.id, 'doc-link')
    assert.deepEqual(gate.on, ['stop', 'manual'])
    assert.equal(gate.level, 'blocking')
    assert.equal(typeof gate.check, 'function')
    assert.equal(gate.relevantPath('a.md'), true)
    assert.equal(gate.relevantPath('notes/readme.MD'), true)
    assert.equal(gate.relevantPath('src/main.ts'), false)
    assert.ok(gate.rationale.length > 0, 'rationale must be written')
    assert.ok(gate.description.length > 0, 'description must be written')
  })
})
