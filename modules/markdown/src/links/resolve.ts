/**
 * Resolve layer (self-written — no host equivalent; the host's
 * `findViolations` is gate orchestration bound to `PATTERNS` + `process.exit`,
 * not a reusable API). Semantics align with upstream `verify-md-links.ts`:
 * `//`, `/`, and scheme targets are skipped; a `#fragment` on an
 * empty path resolves to the source file; document-relative targets resolve
 * against the source directory; malformed `%zz` stays raw (fail-closed, the
 * link reports broken rather than crashing). Extraction walks the forked mdast
 * AST, not a regex state machine; anchors come from the forked
 * `anchors.ts`. Wikilinks are not parsed.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import { anchorCache } from './anchors.js'
import { gitLinkPaths, gitLsFiles, gitTopLevel, type GitLsFiles } from './git.js'
import { markdownDestination, parseMarkdown, visitMarkdown, type MarkdownDestinationNode } from './markdown.js'

/** Stable reason strings the doc-link gate branches its remedy on — reword here, never in the gate. */
export const REASON_ANCHOR_MISSING = 'anchor does not exist'

export type ReferenceKind = 'link' | 'image' | 'definition'

/** One authored link/image/definition, located byte-exactly in the source. */
export interface LinkReference {
  kind: ReferenceKind
  /** 1-based source line. */
  line: number
  /** Parsed destination url (mdast `node.url`; angle brackets already stripped). */
  url: string
  /** Byte offset of the destination start in the source; absent on autolinks and other forms with no destination substring to rewrite. */
  start?: number
  /** Exclusive byte offset of the destination end; absent where `start` is absent. */
  end?: number
}

/** One reference's resolution outcome; exactly one of `ignored` / `reason` / `abs` is set. */
export interface Resolution {
  ignored?: boolean
  abs?: string
  fragment?: string | null
  reason?: string
}

export interface LinkViolation {
  file: string
  line: number
  url: string
  reason: string
  /** Absolute resolved target path — present when the target exists inside the repository (anchor-missing onto a Markdown target), absent for missing/outside targets. */
  targetAbs?: string
}

/** Whether `target` is at or below `root` (lexical containment). */
export function pathInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/** POSIX form of a root-relative path; keeps reports deterministic across platforms. */
export function posixRelative(root: string, target: string): string {
  return relative(root, target).split(sep).join('/')
}

/**
 * Memoized `realpathSync` for the repository root. `existingPathInside` runs
 * once per repository-inside reference, and an uncached root realpath turned
 * that into thousands of redundant syscalls on Windows (~1s on a 3.8k-link
 * scan). The worktree root never moves within a session — same caching
 * premise as `gitTopLevel`'s memo — so one resolution per distinct root input
 * is safe; a different input path gets its own key.
 */
const realRootCache = new Map<string, string>()

function realRoot(root: string): string {
  const key = resolve(root)
  const cached = realRootCache.get(key)
  if (cached !== undefined) return cached
  const real = realpathSync(root)
  // Register under both the input path and the real path so a later call with
  // either form hits the same entry.
  realRootCache.set(key, real)
  realRootCache.set(real, real)
  return real
}

function existingPathInside(root: string, target: string, probe?: TargetProbe): boolean {
  if (!pathInside(root, target)) return false
  const real = probe === undefined ? realpathSync(target) : probe(target).real
  return real !== undefined && pathInside(realRoot(root), real)
}

function temporarilyUnverifiable(root: string, target: string, probe?: TargetProbe): boolean {
  if (probe === undefined ? existsSync(target) : probe(target).exists) return false
  for (const gitlink of gitLinkPaths(root)) {
    if (pathInside(gitlink, target)) return true
  }
  return false
}

/**
 * One per-scan existence/realpath probe. Scan targets repeat heavily (a
 * 3.8k-reference scan resolves to ~750 distinct paths, 5:1), and per-reference
 * `existsSync` + `realpathSync` dominates the resolve phase on Windows. A cache
 * scoped to one `checkRepository` call — never module-level — keeps the verdict
 * fresh across turns (files are created and deleted between gate runs). The
 * frozen-worktree-within-a-scan premise is the one the scan already relies on
 * when it reads each source exactly once; the `anchorCache()` factory created
 * per `checkRepository` call is the precedent.
 */
export type TargetProbe = (absPath: string) => { exists: boolean; real?: string }

export function targetProbeCache(): TargetProbe {
  const cache = new Map<string, { exists: boolean; real?: string }>()
  return absPath => {
    const cached = cache.get(absPath)
    if (cached !== undefined) return cached
    const exists = existsSync(absPath)
    const entry = { exists, real: exists ? realpathSync(absPath) : undefined }
    cache.set(absPath, entry)
    return entry
  }
}

/** Every git-visible file (tracked + untracked-not-ignored), absolute and sorted. */
export function collectAllFiles(root: string, git: GitLsFiles = gitLsFiles): string[] {
  const repositoryRoot = git === gitLsFiles ? gitTopLevel(root) : root
  // A tracked file deleted from the working tree (still in the index until
  // staged) is listed by `ls-files --cached` but cannot be read; filter it out
  // so no consumer crashes on ENOENT.
  return git(repositoryRoot)
    .map(file => resolve(repositoryRoot, file))
    .filter(existsSync)
    .sort()
}

/** Repo-authored Markdown documents whose outbound references are checked. */
export function collectMarkdownSources(root: string, git: GitLsFiles = gitLsFiles): string[] {
  return collectAllFiles(root, git).filter(file => file.toLowerCase().endsWith('.md'))
}

/** Canonical repository root used for reports and containment. */
export function repositoryRoot(root: string): string {
  return gitTopLevel(root)
}

/** Extract every Markdown link/image/definition in document order. */
export function extractReferences(source: string): LinkReference[] {
  const out: LinkReference[] = []
  visitMarkdown(parseMarkdown(source), (node) => {
    if (node.type !== 'link' && node.type !== 'image' && node.type !== 'definition') return
    if (!('url' in node)) return
    const position = node.position
    const reference: LinkReference = {
      kind: node.type,
      line: position?.start.line ?? 0,
      url: node.url,
    }
    // Byte offsets exist only for [label](dest) / [label]: dest forms that
    // markdownDestination can locate; autolinks (<url>) and bare URLs have no
    // destination substring to rewrite, so they carry no offsets but still resolve.
    if (position?.start.offset !== undefined && position.end.offset !== undefined) {
      try {
        const destination = markdownDestination(source, node as MarkdownDestinationNode)
        reference.start = destination.start
        reference.end = destination.end
      } catch {
        // no byte offsets; url still resolves through resolveReference.
      }
    }
    out.push(reference)
  })
  return out
}

function isExternal(url: string): boolean {
  if (url.startsWith('//')) return true
  if (url.startsWith('/')) return true
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)
}

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    // Malformed escape names no path/anchors anyone meant; the raw text flows
    // into the lookup and is reported missing (fail-closed).
    return value
  }
}

function pathPart(url: string): string {
  return decodePart(url.replace(/[#?].*$/, ''))
}

function fragmentPart(url: string): string | null {
  const hash = url.indexOf('#')
  if (hash === -1) return null
  return decodePart(url.slice(hash + 1).replace(/\?.*$/, ''))
}

/**
 * Resolve one reference to an absolute path — the single resolution seam for
 * `checkRepository`. External targets are ignored; a fragment on an empty path
 * resolves to the source file; document-relative targets resolve against the
 * source directory (`/` is skipped, never root-relative). The optional `probe`
 * is a per-scan existence/realpath cache (`targetProbeCache`); absent = direct
 * syscalls per reference (the behavior every caller outside a full scan keeps).
 */
export function resolveReference(reference: LinkReference, sourceFile: string, root: string, probe?: TargetProbe): Resolution {
  const url = reference.url
  if (isExternal(url)) return { ignored: true }
  const fragment = fragmentPart(url)
  const target = pathPart(url)
  const resolved = target === '' ? sourceFile : resolve(dirname(sourceFile), target)
  const exists = probe === undefined ? existsSync(resolved) : probe(resolved).exists
  if (!exists) {
    if (temporarilyUnverifiable(root, resolved, probe)) return { ignored: true }
    return { reason: 'target does not exist', fragment }
  }
  if (!existingPathInside(root, resolved, probe)) return { reason: 'outside repository', fragment }
  return { abs: resolved, fragment }
}

/**
 * Lexical variant of `resolveReference` for post-hoc repair: resolves the same
 * URL grammar (external skip, fragment-on-empty-path, percent decoding) but
 * never gates on `existsSync` — the referenced old-path targets are already
 * physically gone, so existence would silently drop every in-link. The caller
 * judges relevance lexically (`pathInside(oldAbs, …)`).
 */
export function resolveReferenceLexically(reference: LinkReference, sourceFile: string): Resolution {
  const url = reference.url
  if (isExternal(url)) return { ignored: true }
  const fragment = fragmentPart(url)
  const target = pathPart(url)
  const resolved = target === '' ? sourceFile : resolve(dirname(sourceFile), target)
  return { abs: resolved, fragment }
}

/**
 * Canonical attribution key: absolute, `/`-separated, `.`/`..` resolved via
 * `resolve`. Lexical only — symlink / parent-traversal filesystem identity and
 * case folding are out of scope (the file-history path-identity boundary).
 * Both the predicate seam below and the gate shim canonicalize through this
 * one function, so `Set.has` membership between the change set and the scan's
 * `sourceFile`/`targetAbs` is exact.
 */
export function canonicalPath(p: string, base: string): string {
  return resolve(base, p).split(sep).join('/')
}

/** Optional predicate seam on `checkRepository` (policy-free mechanism). */
export interface CheckRepositoryOptions {
  /**
   * Keep only violations the predicate accepts. `sourceFile` is the canonical
   * absolute path of the source document (the file carrying the reference);
   * `targetAbs` is the canonical absolute resolved target path, present when
   * the target exists inside the repository — undefined for
   * `target does not exist` and `outside repository`. Absent predicate = keep
   * all (identical to the previous behavior).
   */
  include?: (sourceFile: string, targetAbs?: string) => boolean
}

/** Check every git-visible Markdown source in `root` and return deterministic violations. */
export function checkRepository(root: string, options: CheckRepositoryOptions = {}): LinkViolation[] {
  const repoRoot = repositoryRoot(root)
  const anchorsOf = anchorCache()
  const probe = targetProbeCache()
  const sources = collectMarkdownSources(repoRoot)
  const violations: LinkViolation[] = []
  const include = options.include

  for (const sourceFile of sources) {
    const rel = posixRelative(repoRoot, sourceFile)
    const source = readFileSync(sourceFile, 'utf8')
    for (const reference of extractReferences(source)) {
      const resolved = resolveReference(reference, sourceFile, repoRoot, probe)
      if (resolved.ignored) continue
      if (include !== undefined && !include(
        canonicalPath(sourceFile, repoRoot),
        resolved.abs === undefined ? undefined : canonicalPath(resolved.abs, repoRoot),
      )) continue
      if (resolved.reason) {
        violations.push({ file: rel, line: reference.line, url: reference.url, reason: resolved.reason })
        continue
      }
      const fragment = resolved.fragment
      if (fragment != null && fragment !== '' && resolved.abs!.endsWith('.md') && !anchorsOf(resolved.abs!).has(fragment)) {
        violations.push({ file: rel, line: reference.line, url: reference.url, reason: REASON_ANCHOR_MISSING, targetAbs: resolved.abs })
      }
    }
  }
  return violations
}
