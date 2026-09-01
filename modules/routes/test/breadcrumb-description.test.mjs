import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  breadcrumbSubject,
  createBreadcrumbDescriptionProvider,
  registerBreadcrumbDescriptionProvider,
  resolveBreadcrumbPath,
} from '../lib/breadcrumb-description.js'

const OPTIONS = {
  root: '.',
  excludeDirs: [],
  excludeDotEntries: true,
  respectGitignore: false,
}

async function makeFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'any-routes-breadcrumb-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const write = async (rel, content) => {
    const file = path.join(root, ...rel.split('/'))
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content, 'utf8')
  }

  await write('README.md', '---\ndescription: Workspace root\n---\n# Root\n')
  await write('docs/README.md', '---\ndescription: Docs route\n---\n# Docs\n')
  await write('docs/guide.md', '---\ndescription: Guide file\n---\n# Guide\n')
  await write('docs/nested/README.md', '---\ndescription: Nested route\n---\n# Nested\n')
  await write('docs/nested/item.md', '# Item\nThis is the nested item body.\n')
  await write('plain/placeholder.md', '# Plain\n')
  await write('.agents/README.md', '---\ndescription: Hidden route\n---\n# Hidden\n')
  await write('.agents/hidden.md', '# Hidden\n')

  return root
}

function resolvePath(root, rel, kind = 'file') {
  return resolveBreadcrumbPath(
    {
      path: { path: rel, kind },
      input: { cwd: root, signal: new AbortController().signal, turnId: 't1' },
    },
    OPTIONS,
  )
}

test('breadcrumb resolver emits ancestor README descriptions only, never the file itself', async (t) => {
  const root = await makeFixture(t)
  const result = await resolvePath(root, 'docs/nested/item.md')

  assert.ok(result)
  assert.equal(
    result.value,
    'Docs route > Nested route',
  )
  assert.equal(
    result.meta.markdownPaths,
    'docs/README.md, docs/nested/README.md',
  )
  assert.equal(result.meta.source, 'any_routes')
})

test('scan-root README never stands in for a target without its own description', async (t) => {
  const root = await makeFixture(t)

  // 目录目标自身与中间层均无 README：不产生 crumb，项目根 readme 绝不上溯顶替。
  const folder = await resolvePath(root, 'plain', 'directory')
  assert.equal(folder, undefined)

  // 文件目标同理：项目根 readme 不进链，也不回退为文件自身描述。
  const guide = await resolvePath(root, 'docs/guide.md')
  assert.ok(guide)
  assert.equal(guide.value, 'Docs route')
})

test('a file whose ancestors have no descriptions gets no breadcrumb at all', async (t) => {
  const root = await makeFixture(t)

  // Guide file 的祖先 docs 有描述；plain/placeholder.md 的祖先全无描述且文件
  // 自身不再参与 → 完全没有 breadcrumb（文件本身是要读的，不由面包屑描述）。
  const guide = await resolvePath(root, 'docs/guide.md')
  assert.ok(guide)
  assert.equal(guide.value, 'Docs route')

  const placeholder = await resolvePath(root, 'plain/placeholder.md')
  assert.equal(placeholder, undefined)

  const hidden = await resolvePath(root, '.agents/hidden.md')
  assert.equal(hidden, undefined)
})

test('breadcrumb resolver skips paths outside the workspace root', async (t) => {
  const root = await makeFixture(t)
  const result = await resolvePath(root, '../../etc/passwd')
  assert.equal(result, undefined)
})

test('declarative provider exposes kind/priority/subjectOf and omits an explicit once mode', () => {
  const provider = createBreadcrumbDescriptionProvider(OPTIONS)
  assert.equal(provider.name, 'breadcrumb-description-enricher')
  assert.equal(provider.kind, 'breadcrumb-description')
  assert.equal(provider.priority, 100)
  assert.equal(provider.timeoutMs, 1000)
  assert.equal(provider.mode, undefined)
  assert.equal(typeof provider.resolve, 'function')
  assert.equal(typeof provider.subjectOf, 'function')
})

test('subjectOf projects files onto their directory and directories onto themselves', () => {
  assert.equal(breadcrumbSubject({ path: 'docs/meeting-room/20260822-1436-local-ci-gates/case-1-doc-sync.md', kind: 'file' }), 'docs/meeting-room/20260822-1436-local-ci-gates')
  assert.equal(breadcrumbSubject({ path: 'docs/meeting-room/20260822-1436-local-ci-gates/case-2-coggit-misplaced.md', kind: 'file' }), 'docs/meeting-room/20260822-1436-local-ci-gates')
  assert.equal(breadcrumbSubject({ path: 'docs/meeting-room/20260822-1436-local-ci-gates', kind: 'directory' }), 'docs/meeting-room/20260822-1436-local-ci-gates')
  // workspace-root 文件没有可给的 dirname：退回自身（其祖先链为空，本就无贡献）。
  assert.equal(breadcrumbSubject({ path: 'AGENTS.md', kind: 'file' }), 'AGENTS.md')
})

test('provider rebuilds its turn-scoped description cache when turnId changes', async (t) => {
  const root = await makeFixture(t)
  const provider = createBreadcrumbDescriptionProvider(OPTIONS)
  const resolve = (turnId) => provider.resolve({
    path: { path: 'docs/nested/item.md', kind: 'file' },
    input: { cwd: root, signal: new AbortController().signal, turnId },
  })

  const first = await resolve('turn-1')
  assert.equal(first.value, 'Docs route > Nested route')

  await writeFile(path.join(root, 'docs', 'README.md'), '---\ndescription: Docs route v2\n---\n# Docs\n', 'utf8')

  const second = await resolve('turn-2')
  assert.equal(second.value, 'Docs route v2 > Nested route')
})

test('registers through the declarative registerRelates face', () => {
  const registered = []
  const ctx = {
    inject: (_keys, cb) => {
      cb({ promptMiddleware: { registerRelates: (provider) => registered.push(provider) } })
    },
  }

  registerBreadcrumbDescriptionProvider(ctx, OPTIONS)

  assert.equal(registered.length, 1)
  assert.equal(registered[0].name, 'breadcrumb-description-enricher')
  assert.equal(registered[0].kind, 'breadcrumb-description')
  assert.equal(registered[0].priority, 100)
  assert.equal(registered[0].mode, undefined)
  assert.equal(typeof registered[0].resolve, 'function')
  assert.equal(typeof registered[0].subjectOf, 'function')
})
