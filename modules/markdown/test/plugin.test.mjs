// Plugin-surface tests for md-rename: single-tool registration and the
// conflict → report / certain → move-or-repair routing over the md-links lib.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

import { apply } from '../lib/index.js'

const roots = []

function makeCtx() {
  const defs = []
  return {
    // Soft-inject stub: the gates service is absent in this suite (the gate
    // registration is exercised separately in doc-link-gate.test.mjs), so the
    // callback never fires — same as the plugin loading without gates.
    ctx: {
      tools: { register(def) { defs.push(def) } },
      inject(names, cb) { return undefined },
    },
    defs,
  }
}

function makeExec(cwd) {
  return { agent: { session: { header: { cwd } } } }
}

function fixture(files) {
  const root = join(tmpdir(), `dsh-md-rename-plugin-${process.pid}-${roots.length}`)
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

test('apply registers exactly one md_rename tool', () => {
  const { ctx, defs } = makeCtx()
  apply(ctx)
  assert.equal(defs.length, 1)
  assert.equal(defs[0].name, 'md_rename')
})

test('md_rename moves a file and rewrites the in-link', async () => {
  const { ctx, defs } = makeCtx()
  apply(ctx)
  const root = fixture({
    'README.md': '[g](docs/guide.md)\n',
    'docs/guide.md': '# Guide\n',
  })
  const result = await defs[0].execute({ oldPath: 'docs/guide.md', newPath: 'guide.md' }, makeExec(root))
  assert.equal(result.status, 'moved')
  assert.equal(result.oldPath, 'docs/guide.md')
  assert.equal(result.newPath, 'guide.md')
  assert.deepEqual(result.edited, ['README.md'])
  assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '[g](guide.md)\n')
})

test('md_rename refuses on newPath-exists and reports the conflict instead of guessing', async () => {
  const { ctx, defs } = makeCtx()
  apply(ctx)
  const root = fixture({ 'a.md': '# A\n', 'b.md': '# B\n' })
  const result = await defs[0].execute({ oldPath: 'a.md', newPath: 'b.md' }, makeExec(root))
  assert.equal(result.status, 'conflict')
  assert.equal(result.conflicts.length, 1)
  assert.match(result.conflicts[0].reason, /already exists/)
  // Worktree untouched: the conflict is reported, nothing was moved.
  assert.equal(readFileSync(join(root, 'a.md'), 'utf8'), '# A\n')
  assert.equal(readFileSync(join(root, 'b.md'), 'utf8'), '# B\n')
})

test('md_rename repairs links only when the move already happened (status repaired)', async () => {
  const { ctx, defs } = makeCtx()
  apply(ctx)
  const root = fixture({
    'a.md': '# A\n\n[home](README.md)\n',
    'README.md': '[a](a.md)\n',
  })
  mkdirSync(join(root, 'moved'))
  renameSync(join(root, 'a.md'), join(root, 'moved', 'guide.md'))
  const result = await defs[0].execute({ oldPath: 'a.md', newPath: 'moved/guide.md' }, makeExec(root))
  assert.equal(result.status, 'repaired')
  assert.equal(result.oldPath, 'a.md')
  assert.equal(result.newPath, 'moved/guide.md')
  assert.deepEqual([...result.edited].sort(), ['README.md', 'moved/guide.md'])
  // No move was performed and the links were rewritten to the new location.
  assert.equal(existsSync(join(root, 'a.md')), false)
  assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '[a](moved/guide.md)\n')
  assert.equal(readFileSync(join(root, 'moved', 'guide.md'), 'utf8'), '# A\n\n[home](../README.md)\n')
})

test('md_rename refuses an evidence-free post-hoc call and attaches the remedy exits', async () => {
  const { ctx, defs } = makeCtx()
  apply(ctx)
  const root = fixture({ 'README.md': '# R\n' })
  mkdirSync(join(root, 'untracked'), { recursive: true })
  writeFileSync(join(root, 'untracked', 'u.md'), '# U\n')
  renameSync(join(root, 'untracked'), join(root, 'moved'))
  const result = await defs[0].execute({ oldPath: 'untracked', newPath: 'moved' }, makeExec(root))
  assert.equal(result.status, 'conflict')
  assert.match(result.conflicts[0].reason, /no evidence of a completed rename/)
  // D1 remedy: confirm the real old / restore dance / never-tracked gate-side.
  assert.equal(result.remedy.length, 3)
  assert.match(result.remedy[0], /git status/)
  assert.match(result.remedy[1], /git checkout HEAD/)
  assert.match(result.remedy[2], /never tracked/)
  // Nothing was rewritten on refusal.
  assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '# R\n')
})

test('md_rename honors the workspace gates.yml frozen-dirs policy (single policy source)', async () => {
  const { ctx, defs } = makeCtx()
  apply(ctx)
  const root = fixture({
    'gates.yml': 'gates:\n  - id: doc-link\n    options:\n      frozen-dirs: [archived]\n',
    'README.md': '[g](docs/guide.md)\n',
    'docs/guide.md': '# Guide\n',
    'archived/holder.md': '[g](../docs/guide.md)\n',
  })
  const result = await defs[0].execute({ oldPath: 'docs/guide.md', newPath: 'guide.md' }, makeExec(root))
  assert.equal(result.status, 'moved')
  // Active holder rewritten from the same gates.yml declaration the doc-link
  // gate reads; the frozen holder is reported as a skip and left byte-exact.
  assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '[g](guide.md)\n')
  assert.equal(readFileSync(join(root, 'archived', 'holder.md'), 'utf8'), '[g](../docs/guide.md)\n')
  assert.equal(result.edited.includes('archived/holder.md'), false)
  const frozenSkip = result.skips.find(s => s.file === 'archived/holder.md')
  assert.ok(frozenSkip !== undefined, 'frozen holder rewrite surfaces as a skip')
  assert.match(frozenSkip.reason, /frozen/)
})

test('md_rename fails loud on a malformed workspace frozen-dirs declaration', async () => {
  const { ctx, defs } = makeCtx()
  apply(ctx)
  const root = fixture({
    'gates.yml': 'gates:\n  - id: doc-link\n    options:\n      frozen-dirs: archived\n',
    'README.md': '[g](docs/guide.md)\n',
    'docs/guide.md': '# Guide\n',
  })
  await assert.rejects(
    () => defs[0].execute({ oldPath: 'docs/guide.md', newPath: 'guide.md' }, makeExec(root)),
    /frozen-dirs must be a list/,
    'the tool face must not silently rewrite frozen files while the gate face would fail',
  )
  // Refusal happened at plan time: nothing moved.
  assert.equal(existsSync(join(root, 'docs', 'guide.md')), true)
})
