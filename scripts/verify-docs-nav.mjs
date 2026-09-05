// Package-level docs-nav gate entry: every module owning a docs/ tree keeps its
// documentation reachable from its own entry. Location-anchored — the package
// layout is resolved from this file's own path, so the check is correct no
// matter which workspace root the gates runner passes in (module gate `check`
// receives the session root as its first argument; we deliberately ignore it).
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { verifyDocsNavigation } from './lib/docs-navigation.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Modules owning a docs/ tree with its own README entry. */
const DOC_MODULES = ['gates', 'markdown', 'prompt']

const REMEDY = {
  kind: 'manual',
  guidance: 'Link the document from that module\'s docs/README.md and keep the module README linked to the documentation entry.',
}

export function check(_workspaceRoot) {
  const violations = []
  for (const name of DOC_MODULES) {
    const moduleRoot = join(packageRoot, 'modules', name)
    for (const reason of verifyDocsNavigation({
      entry: join(moduleRoot, 'docs/README.md'),
      root: join(moduleRoot, 'docs'),
      packageReadme: join(moduleRoot, 'README.md'),
    })) {
      violations.push({ reason: `modules/${name}: ${reason}`, remedy: REMEDY })
    }
  }
  return violations
}
