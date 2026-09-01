import path from 'node:path'

export function resolveRoot(root: string, cwd?: string): string {
  return path.resolve(cwd ?? process.cwd(), root)
}

export function routePath(root: string, value: string): string {
  return path.relative(root, value).replace(/\\/g, '/')
}

export function isReadmePath(value: string): boolean {
  return path.basename(value).toLowerCase() === 'readme.md'
}

export function stripMarkdownExtension(value: string): string {
  return value.replace(/\.md$/iu, '')
}

export function normalizeRoutePath(value: string | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/u, '')
  return normalized.length === 0 ? '.' : normalized
}

/**
 * Whether `candidate` is the `root` itself or a descendant of it, judged
 * lexically. Canonical spellings collapse `..`; this mirrors fs-sandbox's
 * `isLexicallyUnder` fast path but also normalizes separators (`\` -> `/`)
 * before comparing, so a caller may pass a `/`-spelled root against a
 * `path.resolve`-produced `\`-spelled candidate on Windows. Case is folded on
 * case-insensitive hosts. A pure-lexical check does NOT resolve symlinks, so it
 * is the route-scan guard, not a sandbox boundary.
 */
export function isPathUnderLexical(candidate: string, root: string, caseSensitive = process.platform !== 'win32'): boolean {
  const norm = (value: string): string => value.replace(/\\/g, '/')
  const a = caseSensitive ? norm(candidate) : norm(candidate).toLowerCase()
  const b = caseSensitive ? norm(root) : norm(root).toLowerCase()
  if (a === b) return true
  const prefix = b.endsWith('/') ? b : b + '/'
  return a.startsWith(prefix)
}
