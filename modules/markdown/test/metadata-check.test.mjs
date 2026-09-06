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

describe('md-metadata nested-git exemption', () => {
  it('skips md inside a nested git root (`.git` directory)', () => {
    const root = fixture({ 'vendored/README.md': '# upstream repo, own conventions\n' })
    mkdirSync(join(root, 'vendored', '.git'), { recursive: true })
    assert.deepEqual(check(root, changes(['vendored/README.md'])), [])
  })

  it('skips md inside a nested git root declared by a `gitdir:` `.git` file', () => {
    const root = fixture({ 'lib/sub/README.md': '# submodule checkout\n' })
    writeFileSync(join(root, 'lib', 'sub', '.git'), 'gitdir: ../../.git/modules/sub\n')
    assert.deepEqual(check(root, changes(['lib/sub/README.md'])), [])
  })

  it('skips md deep under a nested root while still flagging workspace md in the same change set', () => {
    const root = fixture({
      'vendored/deep/docs/a.md': '# nested\n',
      'notes/b.md': '# workspace note without description\n',
    })
    mkdirSync(join(root, 'vendored', '.git'), { recursive: true })
    const violations = check(root, changes(['vendored/deep/docs/a.md', 'notes/b.md']))
    assert.equal(violations.length, 1)
    assert.equal(violations[0].file, 'notes/b.md')
  })

  it('still flags workspace md when the root itself is the git root', () => {
    const root = fixture({ 'README.md': '# root readme without description\n' })
    mkdirSync(join(root, '.git'), { recursive: true })
    const violations = check(root, changes(['README.md']))
    assert.equal(violations.length, 1)
    assert.equal(violations[0].file, 'README.md')
  })

  it('resolves precedence when the root is a git root and a nested git root exists below', () => {
    const root = fixture({
      'vendored/deep/x.md': '# nested\n',
      'README.md': '# workspace root readme without description\n',
    })
    mkdirSync(join(root, '.git'), { recursive: true })
    mkdirSync(join(root, 'vendored', '.git'), { recursive: true })
    const violations = check(root, changes(['vendored/deep/x.md', 'README.md']))
    assert.equal(violations.length, 1)
    assert.equal(violations[0].file, 'README.md')
  })

  it('skips md under a nested root whose `.git` file content is not a `gitdir:` pointer', () => {
    const root = fixture({ 'vendored/README.md': '# nested\n' })
    writeFileSync(join(root, 'vendored', '.git'), 'unrelated content\n')
    assert.deepEqual(check(root, changes(['vendored/README.md'])), [])
  })

  it('keeps flagging md when neither the root nor any subdirectory is a git root', () => {
    const root = fixture({ 'docs/a.md': '# plain\n' })
    assert.equal(check(root, changes(['docs/a.md'])).length, 1)
  })
})

describe('md-metadata homepage README root-marker exemption', () => {
  it('skips a homepage README at a nested package root without frontmatter', () => {
    const root = fixture({
      'pkg/README.md': '# package homepage, GitHub renders it raw\n',
      'pkg/package.json': '{ "name": "pkg", "version": "0.0.0" }\n',
    })
    assert.deepEqual(check(root, changes(['pkg/README.md'])), [])
  })

  it('skips i18n homepage variants (README.zh.md) at a package root', () => {
    const root = fixture({
      'pkg/README.zh.md': '# 包根首页\n',
      'pkg/package.json': '{ "name": "pkg" }\n',
    })
    assert.deepEqual(check(root, changes(['pkg/README.zh.md'])), [])
  })

  it('skips an uppercase-suffix homepage README (README.MD) at a package root', () => {
    const root = fixture({
      'pkg/README.MD': '# homepage, uppercase suffix\n',
      'pkg/package.json': '{ "name": "pkg" }\n',
    })
    assert.deepEqual(check(root, changes(['pkg/README.MD'])), [])
  })

  it('still flags readme-prefixed files that are not homepage variants (readme-notes.md)', () => {
    const root = fixture({
      'pkg/package.json': '{ "name": "pkg" }\n',
      'pkg/readme-notes.md': '# not the homepage\n',
    })
    assert.equal(check(root, changes(['pkg/readme-notes.md'])).length, 1)
  })

  it('skips the workspace-root README when the workspace itself is a package root', () => {
    const root = fixture({
      'README.md': '# this workspace is itself an npm package homepage\n',
      'package.json': '{ "name": "workspace-package" }\n',
    })
    assert.deepEqual(check(root, changes(['README.md'])), [])
  })

  it('still covers non-README md under a package root', () => {
    const root = fixture({
      'pkg/package.json': '{ "name": "pkg" }\n',
      'pkg/docs/guide.md': '# no description\n',
    })
    const violations = check(root, changes(['pkg/docs/guide.md']))
    assert.equal(violations.length, 1)
    assert.equal(violations[0].file, 'pkg/docs/guide.md')
  })

  it('skips a homepage README at a directory marked by a `.gitignore` (repo root without `.git`)', () => {
    const root = fixture({
      'mirror/README.md': '# subtree projection homepage, no .git in this tree\n',
      'mirror/.gitignore': 'node_modules\n',
    })
    assert.deepEqual(check(root, changes(['mirror/README.md'])), [])
  })

  it('skips the workspace-root README when the workspace itself carries a `.gitignore`', () => {
    const root = fixture({
      'README.md': '# workspace homepage\n',
      '.gitignore': '*.log\n',
    })
    assert.deepEqual(check(root, changes(['README.md'])), [])
  })

  it('still covers non-README md under a `.gitignore`-marked root', () => {
    const root = fixture({
      'mirror/.gitignore': 'node_modules\n',
      'mirror/docs/guide.md': '# no description\n',
    })
    assert.equal(check(root, changes(['mirror/docs/guide.md'])).length, 1)
  })

  it('still flags README.md when its directory has no root marker (package.json / .gitignore)', () => {
    const root = fixture({ 'docs/README.md': '# plain workspace readme\n' })
    assert.equal(check(root, changes(['docs/README.md'])).length, 1)
  })

  it('still flags a nested README.md lacking frontmatter inside a package docs folder', () => {
    const root = fixture({
      'pkg/package.json': '{ "name": "pkg" }\n',
      'pkg/docs/README.md': '# inner readme without description\n',
    })
    assert.equal(check(root, changes(['pkg/docs/README.md'])).length, 1)
  })

  it('skips a README at a package root in the same change set while flagging workspace md', () => {
    const root = fixture({
      'pkg/package.json': '{ "name": "pkg" }\n',
      'pkg/README.md': '# homepage\n',
      'notes/b.md': '# workspace note without description\n',
    })
    const violations = check(root, changes(['pkg/README.md', 'notes/b.md']))
    assert.equal(violations.length, 1)
    assert.equal(violations[0].file, 'notes/b.md')
  })
})

describe('md-metadata exempt-basename list', () => {
  it('skips AGENTS.md and CLAUDE.md wherever they sit', () => {
    const root = fixture({
      'AGENTS.md': '# agent instructions, harness-owned format\n',
      'CLAUDE.md': '@AGENTS.md\n',
    })
    assert.deepEqual(check(root, changes(['AGENTS.md', 'CLAUDE.md'])), [])
  })

  it('skips fixed-convention community files (CHANGELOG.md, CONTRIBUTING.md)', () => {
    const root = fixture({
      'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n',
      'CONTRIBUTING.md': '# Contributing\n',
    })
    assert.deepEqual(check(root, changes(['CHANGELOG.md', 'CONTRIBUTING.md'])), [])
  })

  it('skips a default-exempt basename nested in a subdirectory while flagging sibling md', () => {
    const root = fixture({
      'pkg/AGENTS.md': '# nested agent instructions\n',
      'pkg/docs/a.md': '# no description\n',
    })
    const violations = check(root, changes(['pkg/AGENTS.md', 'pkg/docs/a.md']))
    assert.equal(violations.length, 1)
    assert.equal(violations[0].file, 'pkg/docs/a.md')
  })

  it('still flags adjacent names that are not exactly a listed basename', () => {
    const root = fixture({
      'agents-notes.md': '# not an instruction file\n',
      'CHANGELOG.old.md': '# not the fixed-convention file\n',
    })
    assert.equal(check(root, changes(['agents-notes.md', 'CHANGELOG.old.md'])).length, 2)
  })

  it('appends repo-declared names via the exempt-basenames option', () => {
    const root = fixture({ 'CODE_OF_CONDUCT.md': '# convention file\n' })
    assert.equal(check(root, changes(['CODE_OF_CONDUCT.md'])).length, 1)
    const exempted = check(root, changes(['CODE_OF_CONDUCT.md']), { 'exempt-basenames': ['CODE_OF_CONDUCT.md'] })
    assert.deepEqual(exempted, [])
  })

  it('option-declared names keep the defaults (append, not replace)', () => {
    const root = fixture({ 'AGENTS.md': '# still exempt\n', 'SECURITY.md': '# newly exempt\n' })
    assert.deepEqual(
      check(root, changes(['AGENTS.md', 'SECURITY.md']), { 'exempt-basenames': ['SECURITY.md'] }),
      [],
    )
  })

  it('matches option-declared names case-insensitively without globbing', () => {
    const root = fixture({ 'security.md': '# lowercase spelling\n', 'SECURITY-notes.md': '# adjacent name\n' })
    const violations = check(root, changes(['security.md', 'SECURITY-notes.md']), { 'exempt-basenames': ['SECURITY.md'] })
    assert.equal(violations.length, 1)
    assert.equal(violations[0].file, 'SECURITY-notes.md')
  })

  it('fails loud on a malformed exempt-basenames declaration (both lanes)', () => {
    const root = fixture({ 'a.md': '---\ndescription: x\n---\n' })
    assert.throws(() => check(root, changes(['a.md']), { 'exempt-basenames': 'AGENTS.md' }), /exempt-basenames/)
    assert.throws(() => check(root, changes(['a.md']), { 'exempt-basenames': ['docs/AGENTS.md'] }), /exempt-basenames/)
    assert.throws(() => check(root, changes(['a.md']), { 'exempt-basenames': [''] }), /exempt-basenames/)
    // Manual lane (null change set) fails loud too — doc-link frozen-dirs precedent.
    assert.throws(() => check(root, undefined, { 'exempt-basenames': 'AGENTS.md' }), /exempt-basenames/)
  })

  it('pins the .gitignore marker semantics: a subdirectory .gitignore exempts its README (accepted tradeoff)', () => {
    const root = fixture({
      'docs/README.md': '# docs index; sibling .gitignore marks this dir as a root\n',
      'docs/.gitignore': 'generated/\n',
    })
    assert.deepEqual(check(root, changes(['docs/README.md'])), [])
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
    // The registered check delegates to the shared data plane (async gate surface),
    // including the options overlay seam.
    const root = fixture({ 'a.md': '# No frontmatter\n' })
    assert.equal((await metadata.check(root, changes(['a.md']))).length, 1)
    assert.deepEqual(await metadata.check(root, changes(['a.md']), { 'exempt-basenames': ['a.md'] }), [])
  })
})
