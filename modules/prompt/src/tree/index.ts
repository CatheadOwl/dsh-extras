/**
 * Gitignore-aware workspace enumeration → prompt-parse `candidatePaths`.
 *
 * `enumerateWorkspacePaths` walks a workspace root and returns project-relative
 * paths (directories carry a trailing `/`, files do not), honoring every
 * `.gitignore` along the way (root + nested, including a submodule's own).
 * The pure `prompt-parse` lib never touches the filesystem, so its
 * `candidatePaths` come from here.
 */

import { readdir, readFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'

import ignoreFactory from '../../vendor/ignore/index.cjs'

type IgnoreInstance = ReturnType<typeof ignoreFactory>

interface IgnoreScope {
  /** Relative dir of the `.gitignore` that produced `ig`; `''` for the root. */
  root: string
  ig: IgnoreInstance
}

/** Options for `enumerateWorkspacePaths` (reserved; currently empty). */
export interface EnumerateWorkspacePathsOptions {}

/**
 * Enumerate `root` into gitignore-aware, project-relative candidate paths.
 *
 * - Reads each `.gitignore` met during the walk (root + nested, incl. a
 *   submodule's own `.gitignore`) and prunes ignored entries.
 * - Always skips `.git` (the repo metadata dir, or a submodule's `.git` marker).
 * - Never follows symlinks (`Dirent.isFile()` / `isDirectory()` are false for
 *   them), so symlinked subtrees are omitted.
 *
 * Output order is deterministic (entries sorted by name per directory,
 * depth-first). The result is the `candidatePaths` input to
 * `resolvePromptPaths`.
 */
export async function enumerateWorkspacePaths(
  root: string,
  _options: EnumerateWorkspacePathsOptions = {},
): Promise<string[]> {
  const out: string[] = []
  const rootIg = await readGitignore(join(root, '.gitignore'))
  const scopes: IgnoreScope[] = rootIg ? [{ root: '', ig: rootIg }] : []
  await walk(root, '', scopes, out)
  return out
}

async function walk(
  absDir: string,
  relDir: string,
  scopes: IgnoreScope[],
  out: string[],
): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(absDir, { withFileTypes: true })
  } catch {
    // An unreadable subtree contributes no candidates; other branches stay usable.
    return
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const entry of entries) {
    if (entry.name === '.git') continue
    const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`
    if (isIgnored(rel, entry.isDirectory(), scopes)) continue
    if (entry.isDirectory()) {
      out.push(`${rel}/`)
      const childIg = await readGitignore(join(absDir, entry.name, '.gitignore'))
      const childScopes: IgnoreScope[] = childIg ? [...scopes, { root: rel, ig: childIg }] : scopes
      await walk(join(absDir, entry.name), rel, childScopes, out)
    } else if (entry.isFile()) {
      out.push(rel)
    }
    // Symlinks and other special entries are skipped (see the exported JSDoc).
  }
}

/**
 * Whether `rel` (project-relative, no trailing slash) is ignored by any
 * ancestor `.gitignore`. Each scope is evaluated against the path relative to
 * that scope's own directory, so nested `.gitignore` files need no path-prefix
 * rewriting. Directory paths carry a trailing `/` so directory-only patterns
 * (`node_modules/`) match the directory itself, not just its descendants.
 */
function isIgnored(rel: string, isDir: boolean, scopes: IgnoreScope[]): boolean {
  const relPath = isDir ? `${rel}/` : rel
  for (const { root, ig } of scopes) {
    const relToRoot = root === '' ? relPath : relPath.slice(root.length + 1)
    if (relToRoot !== '' && ig.ignores(relToRoot)) return true
  }
  return false
}

async function readGitignore(path: string): Promise<IgnoreInstance | undefined> {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch {
    return undefined
  }
  return ignoreFactory().add(content)
}
