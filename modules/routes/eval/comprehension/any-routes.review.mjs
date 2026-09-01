/**
 * Blind comprehension review for the any_routes projection.
 *
 * The fixture is frozen, but route views are projected by the current plugin
 * build at observation time. This preserves the useful old-eval property that
 * a projection change automatically reaches the reviewer prompt.
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { buildAnyRoutes } from '../../lib/routes.js'
import { defineReviewExperiment } from '../../../../eval/src/index.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(here, 'fixtures.json'), 'utf8'))
const prompt = readFileSync(join(here, 'prompt.md'), 'utf8')
const BASE_OPTIONS = { excludeDirs: [], excludeDotEntries: true, maxFiles: 100, respectGitignore: false }

function buildFixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'any-routes-review-'))
  for (const file of files) {
    const target = join(root, ...file.path.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    const basename = file.path.split('/').pop()
    const content = file.description
      ? `---\ndescription: ${file.description}\n---\n# ${basename}\n`
      : `# ${basename}\n`
    writeFileSync(target, content, 'utf8')
  }
  return root
}

function projectResult(result) {
  const relAnchor = result.anchor === result.root
    ? ''
    : result.anchor.slice(result.root.length + 1).replace(/\\/g, '/')
  return {
    root: '<workspace-root>',
    ...(result.routePath ? { routePath: result.routePath } : {}),
    anchor: relAnchor ? `<workspace-root>/${relAnchor}` : '<workspace-root>',
    depth: result.depth,
    format: result.format,
    routeCount: result.routeCount,
    ...(result.routes ? { routes: result.routes } : { tree: result.tree }),
  }
}

export default defineReviewExperiment({
  id: 'any-routes-comprehension',
  summary: 'Can a fresh model navigate the any_routes flat and tree projections?',
  prompt,
  rubric: join(here, 'rubric.md'),
  async observe() {
    const root = buildFixture(fixture.fixture.files)
    try {
      const hops = []
      for (const hop of fixture.hops) {
        const result = await buildAnyRoutes(root, {
          routePath: hop.params.routePath,
          depth: hop.params.depth ?? 1,
          format: hop.params.format ?? 'flat',
          ...BASE_OPTIONS,
        })
        hops.push({
          heading: hop.id,
          call: hop.params,
          json: projectResult(result),
        })
      }
      return [
        {
          heading: 'Tool',
          entries: [{
            heading: fixture.tool.name,
            paragraphs: [fixture.tool.description, `Parameters: ${JSON.stringify(fixture.tool.parameters)}`],
          }],
        },
        { heading: 'Hops (the call, then the exact output it returned)', entries: hops },
      ]
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
})
