import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { buildAnyRoutes } from '../lib/routes.js'

const BASE_OPTIONS = {
  excludeDirs: [],
  excludeDotEntries: true,
  maxFiles: 100,
  respectGitignore: false,
}

async function makeFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'any-routes-fixture-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const write = async (rel, content) => {
    const file = path.join(root, ...rel.split('/'))
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content, 'utf8')
  }

  await write('README.md', '---\ndescription: Root\n---\n# Root\n')
  await write('AGENTS.md', '# Agents\n')
  await write('explorer/README.md', '---\ndescription: Explorer — 目标 repo 探索层(证据 / 指南)\n---\n# Explorer\n')
  await write('explorer/a.md', '---\ndescription: Alpha doc\n---\n# Alpha\n')
  await write('explorer/b.md', '# Beta\n')
  await write('explorer/sub/README.md', '---\ndescription: Sub route\n---\n# Sub\n')
  await write('Topics/README.md', '---\ndescription: Topics — 专题定稿层\n---\n# Topics\n')

  return root
}

test('depth 0: a truncated folder is represented by its next-level README', async (t) => {
  const root = await makeFixture(t)
  const result = await buildAnyRoutes(root, { depth: 0, format: 'flat', ...BASE_OPTIONS })

  assert.ok(result.routes.includes('README.md | Root'), `root README file line missing, got: ${JSON.stringify(result.routes)}`)
  assert.ok(result.routes.includes('AGENTS.md'), `plain file line missing, got: ${JSON.stringify(result.routes)}`)
  assert.ok(
    result.routes.includes('[truncated: 4] explorer | Explorer — 目标 repo 探索层(证据 / 指南)'),
    `truncated folder must keep its README description, got: ${JSON.stringify(result.routes)}`,
  )
  assert.ok(
    result.routes.includes('[truncated: 1] Topics | Topics — 专题定稿层'),
    `truncated Topics must keep its README description, got: ${JSON.stringify(result.routes)}`,
  )
  assert.ok(
    !result.routes.some((line) => line.includes('explorer/a')),
    `depth 0 must not descend into explorer, got: ${JSON.stringify(result.routes)}`,
  )
})

test('depth 1: folders expand normally and their children truncate with descriptions', async (t) => {
  const root = await makeFixture(t)
  const result = await buildAnyRoutes(root, { depth: 1, format: 'flat', ...BASE_OPTIONS })

  assert.ok(result.routes.includes('explorer/a.md | Alpha doc'), JSON.stringify(result.routes))
  assert.ok(result.routes.includes('explorer/b.md'), JSON.stringify(result.routes))
  assert.ok(
    result.routes.includes('explorer/README.md | Explorer — 目标 repo 探索层(证据 / 指南)'),
    `expanded folder README must be a plain file line, got: ${JSON.stringify(result.routes)}`,
  )
  assert.ok(
    result.routes.includes('[truncated: 1] explorer/sub | Sub route'),
    `truncated subfolder must keep its README description, got: ${JSON.stringify(result.routes)}`,
  )
  assert.ok(result.routes.includes('Topics/README.md | Topics — 专题定稿层'), JSON.stringify(result.routes))

  // Clamp the design: an expanded folder must never emit a bare structural
  // `folder` line (no markdown, no description) — its README is a real file,
  // and the folder line is redundant once its children are listed.
  assert.ok(
    !result.routes.some((line) => line === 'explorer' || line.startsWith('explorer |')),
    `expanded folder must NOT emit a bare folder line, got: ${JSON.stringify(result.routes)}`,
  )
})

test('tree format also carries the truncated folder description', async (t) => {
  const root = await makeFixture(t)
  const result = await buildAnyRoutes(root, { depth: 0, format: 'tree', ...BASE_OPTIONS })

  const explorer = findNode(result.tree, 'explorer')
  assert.ok(explorer, 'tree contains explorer node')
  assert.equal(explorer.description, 'Explorer — 目标 repo 探索层(证据 / 指南)')
  assert.equal(explorer.truncated, true)
  assert.equal(explorer.omittedMarkdownCount, 4)
})

test('truncated folder carries README description and counts .md recursively, not raw children', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'any-routes-nested-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const write = async (rel, content) => {
    const file = path.join(root, ...rel.split('/'))
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content, 'utf8')
  }
  await write('docs/README.md', '---\ndescription: Docs root\n---\n# Docs\n')
  await write('docs/a.md', '# A\n')
  await write('docs/sub/b.md', '# B\n')
  await write('docs/notes.yaml', 'note: x\n') // not .md, must not count

  const result = await buildAnyRoutes(root, { depth: 0, format: 'flat', ...BASE_OPTIONS })

  // docs recursive .md = README + a + sub/b = 3 (notes.yaml excluded)
  assert.ok(
    result.routes.includes('[truncated: 3] docs | Docs root'),
    `truncated docs must carry README description and recursive .md count, got: ${JSON.stringify(result.routes)}`,
  )
})

test('a file with no explicit description falls back to its first substantive line', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'any-routes-fallback-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const write = async (rel, content) => {
    const file = path.join(root, ...rel.split('/'))
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content, 'utf8')
  }
  await write('plain.md', '# Plain\n\nEnglish | [中文](README.zh.md)\n\nThis is the fallback description line that is long enough.\n')

  const result = await buildAnyRoutes(root, { depth: 0, format: 'flat', ...BASE_OPTIONS })
  assert.ok(
    result.routes.includes('plain.md | This is the fallback description line that is long enough.'),
    `expected fallback description, got: ${JSON.stringify(result.routes)}`,
  )
})

test('an expanded folder emits its README as a plain file node, not a folder node', async (t) => {
  const root = await makeFixture(t)
  const result = await buildAnyRoutes(root, { routePath: 'explorer', depth: 1, format: 'tree', ...BASE_OPTIONS })

  const readme = findNode(result.tree, 'explorer/README.md')
  assert.ok(readme, `tree must contain explorer/README.md file node, got: ${JSON.stringify(result.tree)}`)
  assert.equal(readme.kind, 'file')
  assert.equal(readme.path, 'explorer/README.md', `file node path must be the full .md path, got: ${JSON.stringify(result.tree)}`)
  assert.equal(readme.markdown, undefined, `file node must not carry a markdown field, got: ${JSON.stringify(result.tree)}`)
  assert.equal(readme.description, 'Explorer — 目标 repo 探索层(证据 / 指南)')

  // The README must NOT additionally promote a folder node at `explorer`.
  const explorer = findNode(result.tree, 'explorer')
  assert.equal(explorer.kind, undefined, `expanded folder must be structural-only (no kind), got: ${JSON.stringify(result.tree)}`)
  assert.equal(explorer.markdown, undefined, `expanded folder must not carry the README as its own markdown, got: ${JSON.stringify(result.tree)}`)
})

test('routePath with .. escape is refused with a route-path-escaped diagnostic', async (t) => {
  const root = await makeFixture(t)
  const result = await buildAnyRoutes(root, { routePath: '../../etc', depth: 1, format: 'flat', ...BASE_OPTIONS })

  assert.equal(result.routeCount, 0, `escaped scan must read nothing, got: ${JSON.stringify(result)}`)
  assert.equal(result.anchor, root, `escaped scan must anchor at the workspace root, got: ${JSON.stringify(result)}`)
  assert.equal(result.routes.length, 0)
  const escaped = result.diagnostics.find((d) => d.code === 'route-path-escaped')
  assert.ok(escaped, `expected route-path-escaped diagnostic, got: ${JSON.stringify(result.diagnostics)}`)
  assert.equal(escaped.path, '../../etc')
})

test('routePath that lexically collapses back inside root is safe to allow', async (t) => {
  const root = await makeFixture(t)
  // explorer/../explorer collapses to root/explorer (still inside root), so no escape.
  const result = await buildAnyRoutes(root, { routePath: 'explorer/../explorer', depth: 1, format: 'flat', ...BASE_OPTIONS })

  assert.ok(!result.diagnostics.some((d) => d.code === 'route-path-escaped'),
    `collapse-back-inside must NOT be flagged escaped, got: ${JSON.stringify(result.diagnostics)}`)
  assert.equal(result.routeCount > 0, true)
})

test('routePath that escapes after collapse is refused', async (t) => {
  const root = await makeFixture(t)
  // explorer/../../../etc collapses outside root.
  const result = await buildAnyRoutes(root, { routePath: 'explorer/../../../etc', depth: 1, format: 'flat', ...BASE_OPTIONS })

  const escaped = result.diagnostics.find((d) => d.code === 'route-path-escaped')
  assert.ok(escaped, `expected route-path-escaped diagnostic, got: ${JSON.stringify(result.diagnostics)}`)
  assert.equal(result.routeCount, 0)
})

test('normal in-root routePath still scans (regression guard)', async (t) => {
  const root = await makeFixture(t)
  const result = await buildAnyRoutes(root, { routePath: 'explorer', depth: 1, format: 'flat', ...BASE_OPTIONS })

  assert.equal(result.routeCount > 0, true)
  assert.equal(result.anchor, path.join(root, 'explorer'), `anchor must be the resolved route root, got: ${JSON.stringify(result)}`)
  assert.ok(!result.diagnostics.some((d) => d.code === 'route-path-escaped'))
  assert.ok(result.routes.includes('explorer/a.md | Alpha doc'), JSON.stringify(result.routes))
})

test('flat routes are sorted case-insensitively by route path', async (t) => {
  const root = await makeFixture(t)
  const result = await buildAnyRoutes(root, { depth: 1, format: 'flat', ...BASE_OPTIONS })

  const paths = result.routes.map((line) => {
    const body = line.replace(/^\[truncated: \d+\] /u, '')
    return body.split(' | ')[0].replace(/\.md$/u, '')
  })
  const sorted = [...paths].sort((a, b) => a.localeCompare(b))
  assert.deepEqual(paths, sorted, `routes must be sorted by route path, got: ${JSON.stringify(result.routes)}`)
})

function findNode(nodes, targetPath) {
  for (const node of nodes ?? []) {
    if (node.path === targetPath) return node
    const found = findNode(node.children, targetPath)
    if (found) return found
  }
  return undefined
}
