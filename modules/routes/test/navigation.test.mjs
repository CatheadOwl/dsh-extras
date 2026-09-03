import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { buildAnyRoutes } from '../lib/routes.js'

// Deterministic replay of the model-navigability eval: a fresh model walks
// root -> explorer -> explorer/sandbox-containment using only route views.
// The fixture reproduces the *shape* that caused real confusion (nested folder
// with README + plain .md, a folder that truncates from the root but expands
// when it is the route root, and a folder whose sub-subfolders only truncate
// one level deeper). The process recipe + rubric live in ../eval/README.md.

const BASE_OPTIONS = {
  excludeDirs: [],
  excludeFiles: [],
  excludeDotEntries: true,
  maxFiles: 100,
  respectGitignore: false,
}

async function makeNavigationFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'any-routes-nav-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const write = async (rel, content) => {
    const file = path.join(root, ...rel.split('/'))
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content, 'utf8')
  }

  await write('README.md', '---\ndescription: Root\n---\n# Root\n')
  await write('explorer/README.md', '---\ndescription: Explorer route\n---\n# Explorer\n')
  await write('explorer/sandbox-containment/README.md', '---\ndescription: Sandbox containment\n---\n# Sandbox containment\n')
  await write('explorer/sandbox-containment/containment.md', '# Containment\n') // no description -> bare line
  await write('explorer/compact/evidence.md', '# Evidence\n')
  await write('explorer/compact/summary.md', '# Summary\n')
  await write('explorer/_TEMPLATE/evidence/README.md', '---\ndescription: Evidence template\n---\n# Evidence template\n')
  await write('explorer/_TEMPLATE/evidence/evidence.md', '# Evidence body\n')
  await write('explorer/_TEMPLATE/guide/guide.md', '# Guide\n')

  return root
}

function truncatedCount(routes, folderPath) {
  const line = routes.find((r) => r.includes('[truncated: ') && r.includes(folderPath))
  if (!line) return null
  const match = line.match(/\[truncated: (\d+)\]/)
  return match ? Number(match[1]) : null
}

test('three-hop navigation: truncation N is stable across observation depth and folders expand to files', async (t) => {
  const root = await makeNavigationFixture(t)

  // Hop 1: root, depth 1. Folders under explorer sit at the depth boundary and truncate.
  const hop1 = await buildAnyRoutes(root, { depth: 1, format: 'flat', ...BASE_OPTIONS })
  assert.equal(hop1.anchor, root, `hop1 anchor must be the workspace root, got: ${JSON.stringify(hop1)}`)
  assert.ok(hop1.routes.includes('README.md | Root'), JSON.stringify(hop1.routes))
  assert.ok(hop1.routes.includes('explorer/README.md | Explorer route'), JSON.stringify(hop1.routes))
  assert.ok(
    hop1.routes.includes('[truncated: 2] explorer/sandbox-containment | Sandbox containment'),
    `truncated folder must carry its README description, got: ${JSON.stringify(hop1.routes)}`,
  )
  assert.ok(
    hop1.routes.includes('[truncated: 2] explorer/compact'),
    `folder without README truncates to a bare name, got: ${JSON.stringify(hop1.routes)}`,
  )
  assert.ok(
    hop1.routes.includes('[truncated: 3] explorer/_TEMPLATE'),
    `nested folder truncates at the root with its recursive .md count, got: ${JSON.stringify(hop1.routes)}`,
  )

  // Hop 2: routePath explorer, depth 1. The same folders now expand; only the
  // sub-subfolders (_TEMPLATE/evidence, _TEMPLATE/guide) sit at the boundary.
  const hop2 = await buildAnyRoutes(root, { routePath: 'explorer', depth: 1, format: 'flat', ...BASE_OPTIONS })
  assert.equal(hop2.anchor, path.join(root, 'explorer'), `hop2 anchor must be root/explorer, got: ${JSON.stringify(hop2)}`)
  assert.ok(hop2.routes.includes('explorer/README.md | Explorer route'), JSON.stringify(hop2.routes))
  assert.ok(hop2.routes.includes('explorer/compact/evidence.md'), JSON.stringify(hop2.routes))
  assert.ok(hop2.routes.includes('explorer/compact/summary.md'), JSON.stringify(hop2.routes))
  assert.ok(hop2.routes.includes('explorer/sandbox-containment/README.md | Sandbox containment'), JSON.stringify(hop2.routes))
  assert.ok(hop2.routes.includes('explorer/sandbox-containment/containment.md'), JSON.stringify(hop2.routes))
  assert.ok(hop2.routes.includes('[truncated: 2] explorer/_TEMPLATE/evidence | Evidence template'), JSON.stringify(hop2.routes))
  assert.ok(hop2.routes.includes('[truncated: 1] explorer/_TEMPLATE/guide'), JSON.stringify(hop2.routes))

  // Expanded folders must not leak a bare structural folder line, nor keep a
  // truncated marker for a folder that is now expanded.
  assert.ok(
    !hop2.routes.some((line) => line === 'explorer' || line.startsWith('explorer |')),
    `expanded folder must NOT emit a bare folder line, got: ${JSON.stringify(hop2.routes)}`,
  )
  assert.ok(
    !hop2.routes.some((line) => line.includes('[truncated: ') && line.includes('explorer/sandbox-containment')),
    `expanded sandbox-containment must not stay truncated, got: ${JSON.stringify(hop2.routes)}`,
  )

  // Hop 3: routePath explorer/sandbox-containment, depth 1. Only the two .md
  // files remain; nothing truncates because nothing nests below.
  const hop3 = await buildAnyRoutes(root, { routePath: 'explorer/sandbox-containment', depth: 1, format: 'flat', ...BASE_OPTIONS })
  assert.equal(hop3.anchor, path.join(root, 'explorer', 'sandbox-containment'), `hop3 anchor must be the target folder, got: ${JSON.stringify(hop3)}`)
  assert.ok(hop3.routes.includes('explorer/sandbox-containment/README.md | Sandbox containment'), JSON.stringify(hop3.routes))
  assert.ok(hop3.routes.includes('explorer/sandbox-containment/containment.md'), JSON.stringify(hop3.routes))
  assert.ok(!hop3.routes.some((line) => line.includes('[truncated: ')), `leaf hop must not truncate, got: ${JSON.stringify(hop3.routes)}`)

  // Cross-hop invariant: the truncated N at hop 1 equals the number of file
  // lines the same folder expands to at hop 3 (N = recursive .md count, stable
  // regardless of which scan root observes the folder).
  const truncatedN = truncatedCount(hop1.routes, 'explorer/sandbox-containment')
  assert.equal(truncatedN, 2, `hop1 truncated N must be 2, got: ${JSON.stringify(hop1.routes)}`)
  assert.equal(hop3.routes.length, truncatedN, `hop3 expands to exactly the truncated N file lines, got: ${JSON.stringify(hop3.routes)}`)
  assert.equal(hop3.routeCount, 2, `hop3 routeCount must equal its line count, got: ${JSON.stringify(hop3)}`)
})
