/**
 * Git scan source (self-written — no host equivalent; the host's
 * `uniqueRepoFiles` is a `globSync` set, not git). The data plane asks git for
 * the repository file list instead of walking the file system, so gitignored
 * artifacts and submodule contents (gitlinks only) never enter the scan.
 *
 * `captureGitStdout` captures stdout through a temp file rather than a pipe:
 * pipe capture is EPERM under sandboxed hosts (the dsh agent sandbox forbids
 * named pipes), and a temp file is equally valid for a one-shot synchronous
 * read. Pure over node + git — no cordis/dsh deps, so it stays node:test-able.
 */
import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** Injectable git-list delegate: `(root) => repository-relative file paths`. */
export type GitLsFiles = (root: string) => string[]

/**
 * Single safe-spawn primitive. Captures stdout
 * through a temp file rather than a pipe: pipe capture is EPERM under sandboxed
 * hosts, and a temp file is equally valid for a one-shot synchronous read.
 * Exported so the rename kernel (git grep / git mv) and any future consumer
 * share one source — never hand-roll another spawn in per-item loops.
 */
export function captureGitStdout(root: string, args: readonly string[], tempName: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-md-links-git-'))
  const outFile = join(dir, tempName)
  try {
    const fd = openSync(outFile, 'w')
    try {
      execFileSync('git', ['-C', root, ...args], {
        stdio: ['ignore', fd, 'ignore'],
      })
    } finally {
      closeSync(fd)
    }
    return readFileSync(outFile, 'utf8')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Absolute git worktree root for a session cwd or any path inside the worktree.
 * Memoized per resolved path: `rev-parse --show-toplevel` spawns a fresh `git`
 * subprocess (~60–250ms on Windows), and the gate scan calls this once per
 * missing reference through `gitLinkPaths` (see `temporarilyUnverifiable`).
 * Without the cache that turns dozens of dead wikilinks into seconds of
 * redundant subprocess spawns. The worktree root never moves within a session,
 * so caching is safe; a different input path (another repo) gets its own key.
 */
const topLevelCache = new Map<string, string>()

export function gitTopLevel(root: string): string {
  const key = resolve(root)
  const cached = topLevelCache.get(key)
  if (cached !== undefined) return cached
  const topLevel = captureGitStdout(root, ['rev-parse', '--show-toplevel'], 'toplevel').trim()
  // Register under both the input path and the canonical top-level so a later
  // call with either form (session cwd vs. repositoryRoot) hits the same entry.
  topLevelCache.set(key, topLevel)
  topLevelCache.set(resolve(topLevel), topLevel)
  return topLevel
}

const gitlinkCache = new Map<string, Set<string>>()

/** Absolute paths recorded as gitlinks (mode 160000) in the current worktree. */
export function gitLinkPaths(root: string): Set<string> {
  const topLevel = gitTopLevel(root)
  const cached = gitlinkCache.get(topLevel)
  if (cached) return cached

  const output = captureGitStdout(topLevel, ['ls-files', '--cached', '--stage', '-z'], 'stage')
  const links = new Set<string>()
  for (const record of output.split('\0')) {
    if (record === '') continue
    const tab = record.indexOf('\t')
    if (tab === -1) continue
    const mode = record.slice(0, record.indexOf(' '))
    if (mode !== '160000') continue
    links.add(join(topLevel, record.slice(tab + 1)))
  }

  gitlinkCache.set(topLevel, links)
  return links
}

/**
 * Tracked files plus untracked-not-ignored files (`--cached --others
 * --exclude-standard`), NUL-separated so any filename survives. The command
 * first canonicalizes `root` to git's toplevel so paths are always repository
 * root-relative, even when invoked from a subdirectory.
 */
export function gitLsFiles(root: string): string[] {
  const topLevel = gitTopLevel(root)
  return captureGitStdout(topLevel, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], 'ls-files')
    .split('\0')
    .filter(Boolean)
}

/**
 * Tracked Markdown files whose content contains the fixed string `pattern`
 * (candidate localization for rename in-links: 1 spawn, then per-candidate
 * resolution filters to real targets). Fixed-string (`-F`) so a basename with
 * `.`/`-`/`(` never acts as a regex. Absolute paths, sorted.
 */
export function gitGrep(root: string, pattern: string): string[] {
  const topLevel = gitTopLevel(root)
  let output: string
  try {
    output = captureGitStdout(topLevel, ['grep', '-l', '-z', '-F', '-e', pattern, '--', '*.md'], 'grep')
  } catch (error) {
    // `git grep` exits 1 on zero matches (not an error); anything else rethrows.
    if ((error as { status?: number }).status === 1) return []
    throw error
  }
  return output
    .split('\0')
    .filter(Boolean)
    .map(file => resolve(topLevel, file))
    .sort()
}

/** One `git status --porcelain -z` record. */
export interface GitStatusRecord {
  /** Two-character porcelain XY (e.g. `'R '` staged rename, `' D'` unstaged delete, `'??'` untracked). */
  xy: string
  /** Repo-root-relative current path (a rename record's NEW side). */
  path: string
  /** Repo-root-relative original path — present on rename/copy records only (the rename's OLD side). */
  origPath?: string
}

/**
 * Worktree state as `git status --porcelain -z` records (1 spawn). Renames and
 * copies carry their original path as the next NUL-separated entry. This is the
 * post-hoc repair evidence data plane (workunits/md-rename TODO
 * 20260831-posthoc-repair-mode D1 tier ①): git witnessing that an old path was
 * tracked and is now gone (`R old→new` staged, or `D old` in either column).
 */
export function gitStatusPorcelain(root: string): GitStatusRecord[] {
  const topLevel = gitTopLevel(root)
  const output = captureGitStdout(topLevel, ['status', '--porcelain', '-z'], 'status')
  const records: GitStatusRecord[] = []
  const entries = output.split('\0')
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (entry === '') continue
    const record: GitStatusRecord = { xy: entry.slice(0, 2), path: entry.slice(3) }
    if (record.xy.charAt(0) === 'R' || record.xy.charAt(0) === 'C') {
      record.origPath = entries[++i]
    }
    records.push(record)
  }
  return records
}

/**
 * Whether `<revision>:<repoRelativePath>` resolves in that tree — the post-hoc
 * HEAD-tier evidence (D1 ②): old is recorded in HEAD while absent from the
 * worktree, i.e. the worktree status cannot witness the move (e.g. a
 * skip-worktree-hidden deletion). One spawn, no stdout; a non-zero exit (also
 * `fatal: invalid object name` in a commit-less repo) simply means "no record".
 */
export function gitTreeHas(root: string, revision: string, repoRelativePath: string): boolean {
  const topLevel = gitTopLevel(root)
  try {
    captureGitStdout(topLevel, ['cat-file', '-e', `${revision}:${repoRelativePath}`], 'cat-file')
    return true
  } catch {
    return false
  }
}

/**
 * Move one tracked path (file or directory) with `git mv`, staging the rename
 * so git remains the state (no runtime). `fromRepoRelative`/`toRepoRelative`
 * are repo-root-relative. Throws on a non-zero git exit (e.g. destination
 * parent missing, path not under version control).
 */
export function gitMove(root: string, fromRepoRelative: string, toRepoRelative: string): void {
  const topLevel = gitTopLevel(root)
  execFileSync('git', ['-C', topLevel, 'mv', fromRepoRelative, toRepoRelative], {
    stdio: ['ignore', 'ignore', 'inherit'],
  })
}
