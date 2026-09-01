// Shared test helpers for the gates plugin suite.
// These tests exercise the BUILT `lib/` artifacts (see README Development),
// never `src/`, so `node --test` runs without the dsh host's `@deepseek-ai/*`
// junctions or any Cordis process.

import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Resolve a compiled ESM module under `lib/` to its file URL string (Windows-safe). */
export function fromLib(rel) {
  const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
  return pathToFileURL(join(pluginRoot, 'lib', rel + '.js')).href
}
