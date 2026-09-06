#!/usr/bin/env node
/**
 * Source-tree purity check: reject compiled artifacts inside module src trees.
 *
 * A stray .js/.d.ts emitted next to its .ts/.tsx source silently poisons
 * every later client bundle: TypeScript's NodeNext .js-suffix specifiers are
 * remapped to .ts by tsc, but literal resolvers (tsdown / rolldown) bind to
 * the real .js file — producing a half-new bundle (CSS current, JS stale)
 * while type checks and tests stay green because they consume lib/ output.
 * See the package's gremlin record for the incident.
 *
 * Allowed in src: .ts, .tsx, .css, and the tracked type declaration
 * css-modules.d.ts. Everything else under the module src trees is a violation.
 * Self-anchored: derives the package root from this file's location and
 * ignores the working directory.
 */
import { readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const packageRoot = join(import.meta.dirname, '..')
const modulesRoot = join(packageRoot, 'modules')
const ALLOWED_BASENAMES = new Set(['css-modules.d.ts'])
const ALLOWED_EXTENSIONS = new Set(['.ts', '.tsx', '.css'])

async function walk(dir, violations) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, violations)
      continue
    }
    if (!entry.isFile()) continue
    if (ALLOWED_BASENAMES.has(entry.name)) continue
    const dot = entry.name.lastIndexOf('.')
    const ext = dot === -1 ? '' : entry.name.slice(dot)
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      violations.push(relative(packageRoot, full).split(sep).join('/'))
    }
  }
}

const modules = (await stat(modulesRoot)).isDirectory()
  ? (await readdir(modulesRoot, { withFileTypes: true })).filter((e) => e.isDirectory())
  : []
const violations = []
for (const module of modules) {
  await walk(join(modulesRoot, module.name, 'src'), violations)
}

if (violations.length > 0) {
  console.error('src purity violations (compiled artifacts in module src trees):')
  for (const path of violations) {
    console.error(`  ${path}`)
  }
  console.error('Delete them and rebuild: tsc emits to lib/, tsdown resolves .js specifiers literally,')
  console.error('so a stray .js shadows its .ts source in every client bundle rebuild.')
  process.exit(1)
}
console.log('src purity: ok')
