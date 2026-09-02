// Plugin-surface tests for the md-metadata gate: the check (change-set
// consumer over frontmatter `description`; cases ported from the archived
// scripts/md-metadata-lib.test.mjs) and the registerGate wiring with a
// soft-inject stub ctx.
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import { check } from '../lib/metadata-check.js'
import { apply } from '../lib/index.js'

const roots = []

function fixture(files) {
  const root = join(tmpdir(), `dsh-md-metadata-${process.pid}-${roots.length}`)
  roots.push(root)
  for (const [path, source] of Object.entries(files)) {
    const abs = join(root, path)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, source)
  }
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const changes = paths => ({ paths, opaque: false })

describe('md-metadata check', () => {
  it('passes a file with a non-empty description', () => {
    const root = fixture({ 'a.md': '---\ndescription: a summary\n---\n# A\n' })
    assert.deepEqual(check(root, changes(['a.md'])), [])
  })

  it('flags a file with no frontmatter at all', () => {
    const root = fixture({ 'a.md': '# No frontmatter\n' })
    const violations = check(root, changes(['a.md']))
    assert.equal(violations.length, 1)
    assert.equal(violations[0].file, 'a.md')
    assert.match(violations[0].reason, /missing YAML frontmatter/)
    assert.equal(violations[0].remedy.kind, 'manual')
  })

  it('flags a file whose frontmatter lacks a description key', () => {
    const root = fixture({ 'a.md': '---\ntitle: T\n---\n# A\n' })
    const violations = check(root, changes(['a.md']))
    assert.equal(violations.length, 1)
    assert.match(violations[0].reason, /no description field/)
  })

  it('flags an empty inline description', () => {
    const root = fixture({ 'a.md': '---\ndescription:\n---\n# A\n' })
    const violations = check(root, changes(['a.md']))
    assert.equal(violations.length, 1)
    assert.match(violations[0].reason, /empty/)
    assert.equal(violations[0].line, 2)
  })

  it('flags an empty quoted description', () => {
    const root = fixture({ 'a.md': '---\ndescription: ""\n---\n' })
    const violations = check(root, changes(['a.md']))
    assert.equal(violations.length, 1)
    assert.match(violations[0].reason, /empty/)
  })

  it('treats unquoted null spellings as empty', () => {
    const root = fixture({
      'null.md': '---\ndescription: null\n---\n',
      'tilde.md': '---\ndescription: ~\n---\n',
    })
    const violations = check(root, changes(['null.md', 'tilde.md']))
    assert.equal(violations.length, 2)
    for (const violation of violations) assert.match(violation.reason, /empty/)
  })

  it('accepts a block-scalar description with content and flags one without', () => {
    const ok = fixture({ 'ok.md': '---\ndescription: |\n  A longer\n  summary.\n---\n' })
    assert.deepEqual(check(ok, changes(['ok.md'])), [])
    const empty = fixture({ 'bad.md': '---\ndescription: |\n---\n' })
    const violations = check(empty, changes(['bad.md']))
    assert.equal(violations.length, 1)
    assert.match(violations[0].reason, /empty/)
  })

  it('accepts `...` closing, CRLF, BOM, and indent/chomping block scalars', () => {
    const root = fixture({
      'dots.md': '---\ndescription: x\n...\n',
      'crlf.md': '---\r\ndescription: x\r\n---\r\n',
      'bom.md': '\uFEFF---\ndescription: x\n---\n',
      'indent.md': '---\ndescription: |2-\n  indented\n---\n',
    })
    assert.deepEqual(check(root, changes(['dots.md', 'crlf.md', 'bom.md', 'indent.md'])), [])
  })

  it('does not skip a file whose path casing differs from the root (Windows)', () => {
    const root = fixture({ 'a.md': '# no frontmatter\n' })
    const misspelled = join(root.toLowerCase(), 'a.md')
    const violations = check(root, changes([misspelled]))
    assert.equal(violations.length, 1)
  })

  it('ignores non-markdown paths, missing files, and out-of-root paths', () => {
    const root = fixture({ 'a.md': '# no frontmatter\n' })
    const violations = check(root, changes(['a.ts', 'gone.md', '../outside.md']))
    assert.deepEqual(violations, [])
  })

  it('returns no violations without a change set (manual entry)', () => {
    const root = fixture({ 'a.md': '# no frontmatter\n' })
    assert.deepEqual(check(root, undefined), [])
    assert.deepEqual(check(root, { paths: [] }), [])
  })
})

describe('md-metadata registerGate wiring', () => {
  it('registers a defer gate with a subagent fixer when the gates service is present', async () => {
    const gates = []
    const tools = []
    const ctx = {
      tools: { register(def) { tools.push(def) } },
      inject(names, cb) {
        assert.deepEqual(names, ['gates'])
        cb({ gates: { register(def) { gates.push(def) } } })
        return undefined
      },
    }
    apply(ctx)
    assert.equal(tools.length, 1) // md_rename; gates are not tools
    const metadata = gates.find(def => def.id === 'md-metadata')
    assert.ok(metadata, 'md-metadata must be registered')
    assert.equal(metadata.level, 'defer')
    assert.equal(metadata.fixer.kind, 'subagent')
    assert.ok(metadata.fixer.prompt.includes('house'))
    assert.equal(metadata.relevantPath('docs/a.md'), true)
    assert.equal(metadata.relevantPath('src/a.ts'), false)
    // The registered check delegates to the shared data plane (async gate surface).
    const root = fixture({ 'a.md': '# No frontmatter\n' })
    assert.equal((await metadata.check(root, changes(['a.md']))).length, 1)
  })
})
