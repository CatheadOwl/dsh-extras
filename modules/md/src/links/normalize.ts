/**
 * Root-relative link normalization seam (self-written, reverses the ADR 0002
 * "存量原地保留" stance): a `/`-prefixed reference whose target is a tracked
 * repository path is rewritten to document-relative form. Rationale: the
 * resolver (resolve.ts) treats `/` as site-root/external and skips it, so an
 * internal `/` link silently rots across renames (the archive move exposed
 * this). After normalization every internal reference resolves through
 * `checkRepository` again instead of being skipped.
 *
 * Scope is deliberately narrow: only `link`/`image`/`definition` references
 * whose destination starts with `/` (and not `//`) AND whose stripped path is a
 * tracked file or a tracked directory are rewritten. Everything else — site-root
 * paths (`/gates`, `/api`), protocol-relative (`//`), scheme URLs, and
 * unresolved `/` links — is left verbatim and reported as a skip. The rewrite is
 * byte-preserving via `rebaseDestination`, so the `#fragment` / `?query` suffix
 * and every other byte survive.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { gitLsFiles, gitTopLevel, type GitLsFiles } from './git.js'
import { rebaseDestination } from './rebase.js'
import { collectMarkdownSources, extractReferences, posixRelative, type LinkReference } from './resolve.js'

/** One planned rewrite (a `/`-prefixed reference migrated to document-relative). */
export interface RootRelativeRewrite {
  /** POSIX root-relative source file. */
  file: string
  /** 1-based source line. */
  line: number
  /** Original `/`-prefixed destination. */
  url: string
  /** Computed document-relative href (path part; suffix re-appended on apply). */
  href: string
}

/** One `/`-prefixed reference left untouched, with why. */
export interface RootRelativeSkip {
  file: string
  line: number
  url: string
  reason: string
}

export interface RootRelativePlan {
  /** Git worktree root — carried so apply needs no re-discovery. */
  root: string
  /** Absolute source path → fully rewritten content (only files with ≥1 rewrite). */
  editsByFile: Map<string, string>
  rewrites: RootRelativeRewrite[]
  skips: RootRelativeSkip[]
}

export interface RootRelativeApplyResult {
  /** Root-relative paths whose content was rewritten. */
  edited: string[]
}

interface PerFileRewrite {
  reference: LinkReference
  href: string
}

/** Tracked files plus every ancestor directory, as POSIX root-relative keys. */
function trackedPathKeys(root: string, git: GitLsFiles): { files: Set<string>; dirs: Set<string> } {
  const files = new Set<string>()
  const dirs = new Set<string>()
  for (const rel of git(root)) {
    files.add(rel)
    let cursor = rel
    for (;;) {
      const slash = cursor.lastIndexOf('/')
      if (slash === -1) break
      cursor = cursor.slice(0, slash)
      dirs.add(cursor)
    }
  }
  return { files, dirs }
}

function skipOf(root: string, sourceFile: string, ref: LinkReference, url: string, reason: string): RootRelativeSkip {
  return { file: posixRelative(root, sourceFile), line: ref.line, url, reason }
}

/**
 * Plan the root-relative → document-relative normalization without writing
 * anything. Iterates every git-visible Markdown source (so the submodule and
 * gitignored artifacts never enter), locates `/`-prefixed references
 * byte-exactly, and rewrites only those whose target is a tracked path.
 */
export function planRootRelativeNormalization(root: string, git: GitLsFiles = gitLsFiles): RootRelativePlan {
  const repoRoot = gitTopLevel(root)
  const { files, dirs } = trackedPathKeys(repoRoot, git)
  const editsByFile = new Map<string, string>()
  const rewrites: RootRelativeRewrite[] = []
  const skips: RootRelativeSkip[] = []

  for (const sourceFile of collectMarkdownSources(repoRoot, git)) {
    const source = readFileSync(sourceFile, 'utf8')
    const perFile: PerFileRewrite[] = []
    for (const ref of extractReferences(source)) {
      const url = ref.url
      if (!url.startsWith('/') || url.startsWith('//')) continue // only /-prefixed, never protocol-relative
      const bare = url.slice(1).replace(/[#?].*$/, '') // strip leading / and any suffix
      if (bare === '') continue // link to the repository root itself (`/` or `/#frag`)
      const hadTrailingSlash = bare.endsWith('/')
      const key = hadTrailingSlash ? bare.slice(0, -1) : bare

      let targetRel: string
      if (files.has(key)) targetRel = key
      else if (dirs.has(key)) targetRel = key
      else {
        skips.push(skipOf(repoRoot, sourceFile, ref, url, 'not a tracked repository path (site-root or unresolved)'))
        continue
      }
      if (ref.start === undefined || ref.end === undefined) {
        skips.push(skipOf(repoRoot, sourceFile, ref, url, 'no rebasable destination (autolink / bare URL)'))
        continue
      }

      let href = posixRelative(dirname(sourceFile), resolve(repoRoot, targetRel))
      if (hadTrailingSlash && !href.endsWith('/')) href += '/'
      rewrites.push({ file: posixRelative(repoRoot, sourceFile), line: ref.line, url, href })
      perFile.push({ reference: ref, href })
    }
    if (perFile.length > 0) {
      // Non-overlapping AST nodes: apply in descending start order keeps offsets valid.
      const ordered = [...perFile].sort((a, b) => (b.reference.start ?? 0) - (a.reference.start ?? 0))
      let out = source
      for (const { reference, href } of ordered) out = rebaseDestination(out, reference, href)
      editsByFile.set(sourceFile, out)
    }
  }

  return { root: repoRoot, editsByFile, rewrites, skips }
}

/** Apply a plan: write every rewritten file (pure content rewrite, no git move). */
export function applyRootRelativeNormalization(plan: RootRelativePlan): RootRelativeApplyResult {
  for (const [file, content] of plan.editsByFile) writeFileSync(file, content)
  return { edited: [...plan.editsByFile.keys()].map(file => posixRelative(plan.root, file)) }
}
