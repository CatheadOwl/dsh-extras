/**
 * The generic `md-metadata` gate surface: every Markdown file written in the
 * current session (the session change set) must declare a non-empty
 * `description` in its YAML frontmatter. Pure Node, no third-party
 * dependencies. Filtering which written paths to check (only `.md`) and how
 * to read the frontmatter is this module's own business, per the repo's
 * "filter 是具体脚本代码的事情" decision.
 *
 * Lineage: this is the former repo-level data plane
 * `scripts/md-metadata-lib.mjs` (declared in the repo-root `gates.yml` as a
 * `module:` gate), now shipped inside the md module so every consumer of the
 * package gets the same check without copying a script. `check(root,
 * changes?)` keeps the generic gate surface — a repo wanting its own
 * equivalent repo-level declaration writes a local entry in this shape.
 *
 * Known boundary: `changes.paths` only carries precise `write`/`edit` tool
 * calls; files produced by opaque tools (bash/subagents) or external editors
 * are invisible here (same limitation as the W2 dirty tracking). Those files
 * surface on their next precise write or a manual git review. A `null`
 * change set (manual `/gates` run) returns no violations: the gate is a
 * change-set consumer, not a full-repo scanner.
 *
 * Git-boundary exemption: the gate never reaches into another repository
 * nested under the workspace root — a session-written Markdown file whose
 * nearest `.git` root sits strictly below the workspace is skipped, because
 * that content belongs to a repository keeping its own conventions (a
 * vendored submodule's SSOT lives upstream). This mirrors the boundary the
 * module's scan-based faces (`md_rename`, `doc-link`) already keep by asking
 * git for the file list; this face is fed from the session event log instead,
 * so it probes `.git` itself (see `insideNestedGitRoot`).
 *
 * Package-root README exemption: a homepage `README.md` (or a variant like
 * `README.zh.md`) living in a directory with
 * its own `package.json` (an npm package root — the workspace root when it
 * is itself a package, or a physically-colocated-but-logically-independent
 * package nested under it, e.g. a subtree projection mirrored to its own
 * repository without a `.git` in the source tree) is skipped. That file
 * doubles as the package/repository homepage, and GitHub renders it raw —
 * YAML frontmatter shows up as literal `---` noise — so it intentionally
 * carries no description; its conventions belong to the package, not this
 * workspace's gate. Non-README md under the package root stays covered:
 * only the homepage file has the rendering constraint.
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

import type { GateChangeSet, GateViolation } from '@catheadowl/dsh-extras/gates/register'

const MANUAL_REMEDY = {
  kind: 'manual' as const,
  guidance:
    'Add (or fill) a `description` field in the YAML frontmatter at the top of '
    + 'the file — e.g. `---\ndescription: <one-line summary>\n---`.',
}

/** POSIX form of a root-relative path; keeps reports deterministic across platforms. */
function posixRelative(root: string, target: string): string {
  return relative(root, target).split(sep).join('/')
}

/**
 * Extract the leading YAML frontmatter body lines (between the opening `---`
 * and a closing `---` / `...`), or null when the file has no terminated
 * frontmatter block. Tolerates a UTF-8 BOM and CRLF line endings.
 */
function frontmatterBodyLines(source: string): string[] | null {
  const text = source.replace(/^\uFEFF/, '')
  if (!/^---[ \t]*(?:\r?\n|$)/.test(text)) return null
  const lines = text.split(/\r?\n/)
  for (let index = 1; index < lines.length; index += 1) {
    if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[index]!)) return lines.slice(1, index)
  }
  return null
}

type DescriptionStatus = 'present' | 'empty' | 'missing'

/**
 * Locate the top-level `description` key in a frontmatter body and classify
 * its value as present / empty, or missing. Returns the 1-based file line of
 * the key for location reporting. Handles inline scalars (plain and quoted),
 * unquoted YAML null spellings, and block scalars (`|` / `>` with optional
 * indentation and chomping indicators, in either order).
 */
function findDescription(bodyLines: string[]): { status: DescriptionStatus; line: number } {
  for (let index = 0; index < bodyLines.length; index += 1) {
    const line = bodyLines[index]!
    const match = /^description[ \t]*:[ \t]*(.*)$/.exec(line)
    if (match === null) continue
    const fileLine = index + 2 // bodyLines[0] is file line 2 (line 1 is the opening `---`)
    const rest = match[1]!

    if (/^[|>](?:[+-][0-9]*|[0-9]*[+-]?)[ \t]*$/.test(rest)) {
      const keyIndent = (line.match(/^[ \t]*/) ?? [''])[0]!.length
      let hasContent = false
      for (let cursor = index + 1; cursor < bodyLines.length; cursor += 1) {
        const next = bodyLines[cursor]!
        if (/^[ \t]*$/.test(next)) continue
        hasContent = (next.match(/^[ \t]*/) ?? [''])[0]!.length > keyIndent
        break
      }
      return { status: hasContent ? 'present' : 'empty', line: fileLine }
    }

    if (rest.trim() === '') return { status: 'empty', line: fileLine }
    const trimmed = rest.trim()
    const isQuoted = (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2)
      || (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
    if (isQuoted) {
      return { status: trimmed.slice(1, -1).trim() === '' ? 'empty' : 'present', line: fileLine }
    }
    // Unquoted YAML null spellings carry no description.
    if (trimmed === 'null' || trimmed === 'Null' || trimmed === 'NULL' || trimmed === '~') {
      return { status: 'empty', line: fileLine }
    }
    return { status: 'present', line: fileLine }
  }
  return { status: 'missing', line: 1 }
}

function withinRoot(rootAbs: string, target: string): boolean {
  const rootKey = rootAbs.toLowerCase()
  const targetKey = target.toLowerCase()
  return targetKey === rootKey || targetKey.startsWith(rootKey + sep)
}

/**
 * Whether `targetAbs` lives inside a git repository nested *under* `rootAbs`.
 * Walks from the file's own directory up to the workspace root looking for a
 * `.git` entry — a directory, or the `gitdir:` file submodules and linked
 * worktrees use — and reports "nested" only when the nearest one sits strictly
 * below the root. A `.git` at the root itself (or none at all) keeps the file
 * under this workspace's policy: unchanged behavior. `probe` memoizes the
 * per-directory verdict across the paths of one change set so sibling writes
 * pay one `existsSync` per ancestor instead of one per file.
 */
function insideNestedGitRoot(rootAbs: string, targetAbs: string, probe: Map<string, boolean>): boolean {
  const rootKey = rootAbs.toLowerCase()
  let dir = dirname(targetAbs)
  for (;;) {
    if (!withinRoot(rootAbs, dir)) break // defensive; the walk always reaches the root
    // Memo keyed by the exact dir spelling: a lowercased key would let two
    // case-distinct siblings on a case-sensitive filesystem share one verdict.
    let hasGit = probe.get(dir)
    if (hasGit === undefined) {
      hasGit = existsSync(join(dir, '.git'))
      probe.set(dir, hasGit)
    }
    if (hasGit) return dir.toLowerCase() !== rootKey // nested iff the .git sits strictly below the root
    if (dir.toLowerCase() === rootKey) break // reached the root with no nested .git found
    const parent = dirname(dir)
    if (parent === dir) break // filesystem root guard
    dir = parent
  }
  return false
}

/** A homepage README: `README` stem plus optional `.`-separated variant segments (README.zh.md). */
const PACKAGE_README_RE = /^readme(?:\..+)?\.md$/i

/**
 * Whether `targetAbs` is a package-root homepage README: its basename looks
 * like `README.md` (optionally with `.`-separated variant segments, e.g.
 * `README.zh.md`) and its own directory carries a `package.json` — the
 * mechanical package-boundary signal: a package physically colocated under
 * another workspace keeps its own package root while the surrounding tree has
 * none. `probe` memoizes per-directory like the git probe.
 */
function isPackageRootReadme(targetAbs: string, probe: Map<string, boolean>): boolean {
  const dir = dirname(targetAbs)
  if (!PACKAGE_README_RE.test(basename(targetAbs))) return false
  let hasPkg = probe.get(dir)
  if (hasPkg === undefined) {
    hasPkg = existsSync(join(dir, 'package.json'))
    probe.set(dir, hasPkg)
  }
  return hasPkg
}

/** Generic gate surface: check the session change set for `.md` files lacking a description. */
export function check(root: string, changes?: GateChangeSet): GateViolation[] {
  const violations: GateViolation[] = []
  if (changes == null || !Array.isArray(changes.paths)) return violations

  const rootAbs = resolve(root)
  const gitProbe = new Map<string, boolean>()
  const pkgProbe = new Map<string, boolean>()
  for (const path of changes.paths) {
    if (typeof path !== 'string' || path === '' || !path.toLowerCase().endsWith('.md')) continue
    const abs = resolve(root, path)
    if (!withinRoot(rootAbs, abs)) continue
    if (insideNestedGitRoot(rootAbs, abs, gitProbe)) continue
    if (isPackageRootReadme(abs, pkgProbe)) continue

    let source: string
    try {
      source = readFileSync(abs, 'utf8')
    } catch {
      continue // file no longer exists this turn (renamed/deleted); not this gate's concern
    }

    const body = frontmatterBodyLines(source)
    if (body === null) {
      violations.push({
        file: posixRelative(root, abs),
        line: 1,
        reason: 'missing YAML frontmatter with a description field',
        remedy: MANUAL_REMEDY,
      })
      continue
    }

    const found = findDescription(body)
    if (found.status === 'missing') {
      violations.push({
        file: posixRelative(root, abs),
        line: 1,
        reason: 'frontmatter has no description field',
        remedy: MANUAL_REMEDY,
      })
    } else if (found.status === 'empty') {
      violations.push({
        file: posixRelative(root, abs),
        line: found.line,
        reason: 'frontmatter description field is empty',
        remedy: MANUAL_REMEDY,
      })
    }
  }
  return violations
}
