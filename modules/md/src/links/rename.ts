/**
 * Rename transaction kernel (ADR 0001 §2/§3): rebaseHref (a document-relative
 * href from a source file to an absolute target) plus planRename/applyRenamePlan
 * (plan-then-apply, "工作树绝不半改"). Pure lib — no ctx, node:test-able.
 *
 * L1 explicit rename: the caller passes an authoritative oldPath → newPath.
 * L2/L3/L4 (git rename detection / content similarity / agent fallback) are
 * gate-side (路 B) and out of scope here.
 *
 * Post-hoc repair (workunits/md-rename TODO 20260831-posthoc-repair-mode,
 * D1–D4): when the move ALREADY happened — oldPath missing, newPath present,
 * and git can witness it (staged `R old→new`, a `D old` whose shifted new-side
 * counterpart exists on disk, or a HEAD record when the worktree shows
 * nothing) — the same (old, new) pair plans a link-only repair: no `git mv`,
 * in-links resolved lexically (existence-free, never silently dropped),
 * out-links read at the new position and resolved against the old baseline,
 * scoped to the git-witnessed moved files only (an unrelated neighbor under
 * newPath is not part of the move). Without evidence the plan refuses whole —
 * no guessing, no restore.
 *
 * The data plane reuses the mdast seams (extractReferences / resolveReference /
 * rebaseDestination): a reference is located byte-exactly and its destination
 * substring replaced, preserving the fragment/query suffix and every other byte.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, relative, resolve } from 'node:path'

import { gitGrep, gitMove, gitStatusPorcelain, gitTopLevel, gitTreeHas } from './git.js'
import { splitMarkdownUrlTarget } from './markdown.js'
import { rebaseDestination } from './rebase.js'
import {
  extractReferences,
  pathInside,
  posixRelative,
  resolveReference,
  resolveReferenceLexically,
  type LinkReference,
} from './resolve.js'

/** Characters that cannot appear in a bare document-relative markdown target. */
const BARE_DESTINATION_UNSAFE = /[\s()<>]/

/**
 * Conflict reason when oldPath is missing, newPath exists, but git cannot
 * witness a completed rename (D1: refuse with a remedy hint, never guess or
 * restore). The remedy wording belongs to the plugin output layer; this lib
 * only emits the structured reason.
 */
export const REASON_NO_RENAME_EVIDENCE = 'old path does not exist and git has no evidence of a completed rename to the new path'

/** Document-relative href from a source file's directory to an absolute target. */
export function rebaseHref(fromFile: string, toAbs: string): string {
  return posixRelative(dirname(fromFile), toAbs)
}

/** One reference left untouched, with why (informational, never blocks apply). */
export interface RenameSkip {
  file: string
  line: number
  url: string
  reason: string
}

/** One blocking issue: makes `certain` false, forbids apply. */
export interface RenameConflict {
  file: string
  line: number
  url: string
  reason: string
}

export interface RenamePlan {
  /** Git worktree root (repo root) — the plan carries it so apply needs no re-discovery. */
  root: string
  /** Absolute old path (file or directory). */
  oldPath: string
  /** Absolute new path (file or directory). */
  newPath: string
  /** Absolute post-move path → fully rewritten content (out-link + in-link edits). */
  editsByFile: Map<string, string>
  skips: RenameSkip[]
  conflicts: RenameConflict[]
  /**
   * Post-hoc repair: the move already happened under git's witness, so apply
   * rewrites links only — no `git mv`, and the apply result reports
   * `moved: false` (D4).
   */
  linkOnly: boolean
}

export interface RenamePlanResult {
  /** True when the plan is conflict-free and safe to apply. */
  certain: boolean
  plan: RenamePlan
}

export interface RenameApplyResult {
  moved: boolean
  /** Root-relative paths whose content was rewritten (in-link + out-link). */
  edited: string[]
}

interface Rewrite {
  reference: LinkReference
  newHref: string
}

function isInside(dir: string, target: string): boolean {
  return pathInside(dir, target)
}

/** Shift one path under `old` to the corresponding path under `new`. */
function shiftPrefix(old: string, next: string, target: string): string {
  return resolve(next, relative(old, target))
}

/** Markdown files at or under `path` (recursive, pure fs — no git spawn). */
function listMarkdownUnder(path: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = resolve(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (entry.isFile() && abs.toLowerCase().endsWith('.md')) out.push(abs)
    }
  }
  if (statSync(path).isDirectory()) walk(path)
  else if (path.toLowerCase().endsWith('.md')) out.push(path)
  return out
}

/**
 * Apply a set of byte edits to one source. Edits are non-overlapping
 * (distinct AST nodes), so applying in descending start order keeps every
 * remaining edit's offsets valid in the evolving buffer.
 */
function applyRebase(source: string, rewrites: Rewrite[]): string {
  const ordered = [...rewrites].sort((a, b) => (b.reference.start ?? 0) - (a.reference.start ?? 0))
  let out = source
  for (const { reference, newHref } of ordered) {
    out = rebaseDestination(out, reference, newHref)
  }
  return out
}

function conflict(file: string, ref: Pick<LinkReference, 'line' | 'url'>, reason: string): RenameConflict {
  return { file, line: ref.line, url: ref.url, reason }
}

function skip(file: string, ref: Pick<LinkReference, 'line' | 'url'>, reason: string): RenameSkip {
  return { file, line: ref.line, url: ref.url, reason }
}

/** Repo-relative old→new pairs of git-witnessed moved files (D2: the out-link pass scope). */
type MovedFiles = Map<string, string>

/**
 * D1 evidence that "this rename already happened", plus the moved-file set it
 * witnesses. Worktree tier (one `git status --porcelain -z`): staged
 * `R old→new` records, or `D old` records (either column) whose shifted
 * new-side counterpart exists on disk. HEAD tier (one `git cat-file -e`):
 * old recorded in HEAD while the worktree shows nothing (e.g. a
 * skip-worktree-hidden deletion) — run only when the worktree tier found
 * nothing. A staged rename from inside old to somewhere OTHER than the
 * shifted new path contradicts the requested pair and voids the evidence:
 * refuse rather than rewrite towards the wrong destination.
 */
function postHocEvidence(repoRoot: string, oldAbs: string, newAbs: string): MovedFiles | undefined {
  const oldRel = posixRelative(repoRoot, oldAbs)
  const newRel = posixRelative(repoRoot, newAbs)
  /** Suffix of `p` under `oldRel` ('' for old itself), or undefined when outside. */
  const underOld = (p: string): string | undefined =>
    p === oldRel ? '' : p.startsWith(`${oldRel}/`) ? p.slice(oldRel.length) : undefined
  const shiftedRel = (suffix: string): string => (suffix === '' ? newRel : `${newRel}${suffix}`)

  const moved: MovedFiles = new Map()
  for (const record of gitStatusPorcelain(repoRoot)) {
    if (record.origPath !== undefined) {
      const suffix = underOld(record.origPath)
      if (suffix === undefined) continue
      if (record.path === shiftedRel(suffix)) moved.set(record.origPath, record.path)
      else return undefined // staged away from the requested pair — contradiction
    }
    if (record.xy.includes('D')) {
      const suffix = underOld(record.path)
      if (suffix === undefined) continue
      if (existsSync(shiftPrefix(oldAbs, newAbs, resolve(repoRoot, record.path)))) {
        moved.set(record.path, shiftedRel(suffix))
      }
    }
  }
  if (moved.size > 0) return moved

  // HEAD tier (D1 ②): old recorded in HEAD while the worktree cannot witness it.
  if (!gitTreeHas(repoRoot, 'HEAD', oldRel)) return undefined
  if (statSync(newAbs).isDirectory()) {
    const fromHead: MovedFiles = new Map()
    for (const newFile of listMarkdownUnder(newAbs)) {
      fromHead.set(posixRelative(repoRoot, shiftPrefix(newAbs, oldAbs, newFile)), posixRelative(repoRoot, newFile))
    }
    return fromHead
  }
  return new Map([[oldRel, newRel]])
}

/**
 * Plan an explicit rename without writing anything. Resolves old/new against
 * `root` (session workspace), computes the full edit plan (out-link rebase +
 * in-link rewrite + skip/conflict lists), and reports `certain` =
 * conflict-free. When the move already happened under git's witness the plan
 * is link-only (post-hoc repair); oldPath missing without evidence stays a
 * hard conflict.
 */
export function planRename(root: string, oldPath: string, newPath: string): RenamePlanResult {
  const repoRoot = gitTopLevel(root)
  const oldAbs = resolve(root, oldPath)
  const newAbs = resolve(root, newPath)
  const conflicts: RenameConflict[] = []
  const skips: RenameSkip[] = []

  const emptyPlan = (): RenamePlan => ({
    root: repoRoot,
    oldPath: oldAbs,
    newPath: newAbs,
    editsByFile: new Map(),
    skips,
    conflicts,
    linkOnly: false,
  })

  // Hard preconditions — reject whole, no plan.
  if (oldAbs === repoRoot) {
    conflicts.push({ file: posixRelative(repoRoot, oldAbs), line: 0, url: '', reason: 'cannot rename the repository root' })
    return { certain: false, plan: emptyPlan() }
  }
  if (!isInside(repoRoot, oldAbs) || !isInside(repoRoot, newAbs)) {
    conflicts.push({ file: posixRelative(repoRoot, oldAbs), line: 0, url: '', reason: 'rename outside the repository' })
    return { certain: false, plan: emptyPlan() }
  }
  if (oldAbs !== newAbs && isInside(oldAbs, newAbs)) {
    conflicts.push({ file: posixRelative(repoRoot, newAbs), line: 0, url: '', reason: 'new path is inside the old path' })
    return { certain: false, plan: emptyPlan() }
  }

  // Post-hoc candidate: the move already happened — old gone, new present.
  // Evidence gates it (D1); a missing old without evidence stays a conflict.
  const postHoc = !existsSync(oldAbs) && existsSync(newAbs)
  const movedFiles = postHoc ? postHocEvidence(repoRoot, oldAbs, newAbs) : undefined
  if (postHoc && movedFiles === undefined) {
    conflicts.push({ file: posixRelative(repoRoot, oldAbs), line: 0, url: '', reason: REASON_NO_RENAME_EVIDENCE })
    return { certain: false, plan: emptyPlan() }
  }
  if (!postHoc && !existsSync(oldAbs)) {
    conflicts.push({ file: posixRelative(repoRoot, oldAbs), line: 0, url: '', reason: 'old path does not exist' })
    return { certain: false, plan: emptyPlan() }
  }
  if (!postHoc && existsSync(newAbs)) {
    conflicts.push({ file: posixRelative(repoRoot, newAbs), line: 0, url: '', reason: 'new path already exists' })
    return { certain: false, plan: emptyPlan() }
  }

  const editsByFile = new Map<string, string>()

  if (movedFiles !== undefined) {
    // 1p. Out-link rebase over the git-witnessed moved set (D2): content is
    //     read at its physical NEW position but resolved against the OLD
    //     baseline (pre-move semantics, same as L1). A file under newPath
    //     that git cannot place under old is NOT part of the move — its
    //     out-links stay untouched.
    for (const [oldRel, newRel] of movedFiles) {
      const oldFile = resolve(repoRoot, oldRel) // resolution baseline (pre-move position)
      const newFile = resolve(repoRoot, newRel) // physical content location
      const source = readFileSync(newFile, 'utf8')
      const rewrites: Rewrite[] = []
      for (const ref of extractReferences(source)) {
        const resolution = resolveReferenceLexically(ref, oldFile)
        if (resolution.ignored) continue // external / / / scheme → not touched
        const target = resolution.abs!
        if (isInside(oldAbs, target)) {
          // Moves with the subtree → href unchanged (but report a target the
          // move left behind: honesty over silence).
          if (!existsSync(shiftPrefix(oldAbs, newAbs, target))) {
            skips.push(skip(newRel, ref, 'out-link target was not moved to the new location (rename does not repair broken links)'))
          }
          continue
        }
        if (!existsSync(target)) {
          skips.push(skip(newRel, ref, 'out-link target does not exist (rename does not touch broken links)'))
          continue
        }
        if (!isInside(repoRoot, target)) {
          skips.push(skip(newRel, ref, 'out-link outside repository (rename does not touch it)'))
          continue
        }
        if (ref.start === undefined || ref.end === undefined) {
          skips.push(skip(newRel, ref, 'out-link has no rebasable destination (autolink / bare URL)'))
          continue
        }
        const newHref = rebaseHref(newFile, target)
        if (newHref === splitMarkdownUrlTarget(ref.url).path) continue // depth-preserving move → href unchanged
        if (BARE_DESTINATION_UNSAFE.test(newHref)) {
          skips.push(skip(newRel, ref, `rebased href ${JSON.stringify(newHref)} is not representable as a bare markdown target`))
          continue
        }
        rewrites.push({ reference: ref, newHref })
      }
      if (rewrites.length > 0) editsByFile.set(newFile, applyRebase(source, rewrites))
    }

    // 2p. In-link rewrite, resolved lexically (plan-layer difference #1):
    //     targets under the gone old path never pass an existsSync gate, so
    //     every old-pointing reference is either rewritten or reported —
    //     never silently dropped. A moved file at its new position is the
    //     out-link pass's business; an unproven neighbor under newPath stays
    //     an ordinary in-link candidate (D2).
    const movedNewAbs = new Set([...movedFiles.values()].map(rel => resolve(repoRoot, rel)))
    const needle = basename(oldAbs)
    for (const candidateAbs of gitGrep(repoRoot, needle)) {
      if (movedNewAbs.has(candidateAbs)) continue // part of the move → out-link pass owns it
      const source = readFileSync(candidateAbs, 'utf8')
      const rewrites: Rewrite[] = []
      for (const ref of extractReferences(source)) {
        const resolution = resolveReferenceLexically(ref, candidateAbs)
        if (resolution.ignored) continue // not an internal in-link to old
        if (!isInside(oldAbs, resolution.abs!)) continue // points elsewhere
        if (ref.start === undefined || ref.end === undefined) {
          skips.push(skip(posixRelative(repoRoot, candidateAbs), ref, 'in-link has no rebasable destination (autolink / bare URL)'))
          continue
        }
        const newTarget = shiftPrefix(oldAbs, newAbs, resolution.abs!)
        if (!existsSync(newTarget)) {
          skips.push(skip(posixRelative(repoRoot, candidateAbs), ref, `in-link target was not moved to the new location (no counterpart at ${posixRelative(repoRoot, newTarget)})`))
          continue
        }
        const newHref = rebaseHref(candidateAbs, newTarget)
        if (BARE_DESTINATION_UNSAFE.test(newHref)) {
          skips.push(skip(posixRelative(repoRoot, candidateAbs), ref, `rebased href ${JSON.stringify(newHref)} is not representable as a bare markdown target`))
          continue
        }
        rewrites.push({ reference: ref, newHref })
      }
      if (rewrites.length > 0) editsByFile.set(candidateAbs, applyRebase(source, rewrites))
    }

    return {
      certain: conflicts.length === 0,
      plan: { root: repoRoot, oldPath: oldAbs, newPath: newAbs, editsByFile, skips, conflicts, linkOnly: true },
    }
  }

  // 1. Out-link rebase: every moved Markdown file's outbound references,
  //    resolved at the OLD position, rewritten to still resolve from the NEW
  //    position. Targets that move together (inside old) keep their relative
  //    path unchanged and are skipped.
  for (const oldFile of listMarkdownUnder(oldAbs)) {
    const source = readFileSync(oldFile, 'utf8')
    const newFile = shiftPrefix(oldAbs, newAbs, oldFile)
    const rewrites: Rewrite[] = []
    for (const ref of extractReferences(source)) {
      const resolution = resolveReference(ref, oldFile, repoRoot)
      if (resolution.ignored) continue // external / / / scheme → not touched
      if (resolution.reason) {
        skips.push(skip(posixRelative(repoRoot, oldFile), ref, `out-link ${resolution.reason} (rename does not touch broken links)`))
        continue
      }
      if (isInside(oldAbs, resolution.abs!)) continue // moves with the subtree → href unchanged
      if (ref.start === undefined || ref.end === undefined) {
        skips.push(skip(posixRelative(repoRoot, oldFile), ref, 'out-link has no rebasable destination (autolink / bare URL)'))
        continue
      }
      const newHref = rebaseHref(newFile, resolution.abs!)
      if (newHref === splitMarkdownUrlTarget(ref.url).path) continue // depth-preserving move → href unchanged
      if (BARE_DESTINATION_UNSAFE.test(newHref)) {
        skips.push(skip(posixRelative(repoRoot, oldFile), ref, `rebased href ${JSON.stringify(newHref)} is not representable as a bare markdown target`))
        continue
      }
      rewrites.push({ reference: ref, newHref })
    }
    if (rewrites.length > 0) editsByFile.set(newFile, applyRebase(source, rewrites))
  }

  // 2. In-link rewrite: references elsewhere that resolve INTO old, rewritten
  //    to the shifted target. Candidates come from one `git grep -l` on the
  //    old basename; resolution filters to the real moved subtree.
  const needle = basename(oldAbs)
  for (const candidateAbs of gitGrep(repoRoot, needle)) {
    if (isInside(oldAbs, candidateAbs)) continue // moves with the subtree → unchanged
    const source = readFileSync(candidateAbs, 'utf8')
    const rewrites: Rewrite[] = []
    for (const ref of extractReferences(source)) {
      const resolution = resolveReference(ref, candidateAbs, repoRoot)
      if (resolution.ignored || resolution.reason) continue // not an internal in-link to old
      if (!isInside(oldAbs, resolution.abs!)) continue // points elsewhere
      if (ref.start === undefined || ref.end === undefined) {
        skips.push(skip(posixRelative(repoRoot, candidateAbs), ref, 'in-link has no rebasable destination (autolink / bare URL)'))
        continue
      }
      const newTarget = shiftPrefix(oldAbs, newAbs, resolution.abs!)
      const newHref = rebaseHref(candidateAbs, newTarget)
      if (BARE_DESTINATION_UNSAFE.test(newHref)) {
        skips.push(skip(posixRelative(repoRoot, candidateAbs), ref, `rebased href ${JSON.stringify(newHref)} is not representable as a bare markdown target`))
        continue
      }
      rewrites.push({ reference: ref, newHref })
    }
    if (rewrites.length > 0) editsByFile.set(candidateAbs, applyRebase(source, rewrites))
  }

  return {
    certain: conflicts.length === 0,
    plan: { root: repoRoot, oldPath: oldAbs, newPath: newAbs, editsByFile, skips, conflicts, linkOnly: false },
  }
}

/**
 * Apply a certain plan: `git mv` (staging the rename), then write every edit
 * to its post-move path. A link-only (post-hoc) plan skips the move — the
 * files are already in place — and reports `moved: false`. Refuses to run
 * while conflicts remain — the caller must only call this when `certain` is
 * true ("工作树绝不半改").
 */
export function applyRenamePlan(plan: RenamePlan): RenameApplyResult {
  if (plan.conflicts.length > 0) {
    throw new Error(`applyRenamePlan refuses to run with unresolved conflicts: ${plan.conflicts.map(c => c.reason).join('; ')}`)
  }
  const repoRoot = plan.root
  if (!plan.linkOnly) {
    mkdirSync(dirname(plan.newPath), { recursive: true })
    gitMove(repoRoot, posixRelative(repoRoot, plan.oldPath), posixRelative(repoRoot, plan.newPath))
  }
  for (const [file, content] of plan.editsByFile) {
    writeFileSync(file, content)
  }
  return {
    moved: !plan.linkOnly,
    edited: [...plan.editsByFile.keys()].map(file => posixRelative(repoRoot, file)),
  }
}
