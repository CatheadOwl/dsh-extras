/**
 * Compose the prompt-parse policy: three-tier extraction → scope → threshold.
 *
 * `resolvePromptPaths` is the ONLY module that decides anything — which scope a
 * mention is matched against, and whether its ambiguity is acceptable. The
 * primitives `parsePaths` / `suggestPathCandidates` stay decision-free; call
 * them directly when you want the full `{ matches, total }` and your own policy.
 *
 * Policy:
 * - `bare` mention → matched only against candidates within `maxDepth` (default 2)
 * - strong specifier (`dir` / `file` / `path`) → matched against the full tree
 * - root-anchored mention (normalized keeps the leading `/`, the
 *   repository-root-relative citation form) → matched exactly by full position
 *   in `pathMatchesSegments`; `kind`-based scope still applies (`dir` → dirs
 *   only), but the anchor makes the mention a precise position, not a guess
 * - `dir` mention → matched against directory candidates only. Directory
 *   candidates are expected to carry a trailing `/` (e.g. `guides/`); when
 *   the caller does not mark directories that way, this falls back to the full
 *   tree (best effort).
 * - matches are ranked by relevance: an exact leaf-name match first (a dotless
 *   bare word like `gates` prefers the directory `tools/gates/` over
 *   the extension-stripped file `gates.yml`), then shallow depth (a bare `docs`
 *   resolves to the root `docs/`, not `vendor/docs/`), then input
 *   order.
 * - `total === 0` or `total >= ambiguityThreshold` → `resolved: []` (dropped);
 *   otherwise → `resolved` holds every match tied with the top hit on
 *   leaf-exactness + depth (the whole top relevance tier). The input-order
 *   tie-break ranks `matches` but never drops a tied candidate from `resolved`:
 *   a same-name, same-depth tie (e.g. `md-fabric` under two roots) resolves to
 *   all of them, leaving the final pick to the consumer.
 */

import { parsePaths } from './parse.js'
import type { PathCandidate, PathKind, PathRecognizer } from './parse.js'
import { pathMatchesSegments } from './fuzzy.js'

export interface ResolvedMention {
  /** The recognized mention (raw / normalized / offsets / kind). */
  candidate: PathCandidate
  /**
   * First `cap` matching paths, ranked (exact leaf name first, then shallow
   * depth, then input order), de-duplicated. Not the matcher's raw input order:
   * ranking lives in this composer, the matcher stays order-preserving.
   */
  matches: string[]
  /** Full de-duplicated hit count — the ambiguity signal. */
  total: number
  /**
   * Resolution set when `1 <= total < ambiguityThreshold`: every match tied
   * with the top hit on leaf-exactness and depth. The input-order tie-break
   * never drops a tied candidate — a same-name, same-depth tie resolves to all
   * of them (the consumer, not this composer, makes the final pick). Empty when
   * dropped. Cap-independent: computed from the full ranked set, even when
   * `cap` truncates `matches`.
   */
  resolved: string[]
}

export interface ResolvePromptPathsOptions {
  /** Max matches per mention, applied after relevance ranking. Default 5. */
  cap?: number
  /** Depth cap for the `bare` tier only (strong specifiers always match the full tree). Default 2. */
  maxDepth?: number
  /** `total >= this` drops the mention (too ambiguous). Default 5. */
  ambiguityThreshold?: number
  /** Recognizer pipeline; defaults to the v0 pipeline. */
  recognizers?: PathRecognizer[]
}

/**
 * Resolve every path mention in `text` against `candidatePaths`.
 *
 * Returns one `ResolvedMention` per extracted token, in mention order. A
 * dropped mention (`total === 0` or `total >= ambiguityThreshold`) is kept in
 * the array with `resolved: []`, so the caller still sees that it was
 * mentioned but could not be resolved.
 */
export function resolvePromptPaths(
  text: string,
  candidatePaths: Iterable<string>,
  options: ResolvePromptPathsOptions = {},
): ResolvedMention[] {
  const cap = options.cap ?? 5
  const maxDepth = options.maxDepth ?? 2
  const ambiguityThreshold = options.ambiguityThreshold ?? 5
  // Materialize, de-duplicate, and split once: an Iterable may be a single-shot
  // generator, and splitting is the per-candidate cost amortized across mentions
  // (otherwise each candidate is re-split once per mention).
  const tree: string[] = []
  const segmentsOf = new Map<string, string[]>()
  const depthOf = new Map<string, number>()
  const seen = new Set<string>()
  for (const path of candidatePaths) {
    if (seen.has(path)) continue
    seen.add(path)
    tree.push(path)
    const segments = path.split('/').filter(Boolean)
    segmentsOf.set(path, segments)
    depthOf.set(path, segments.length)
  }

  const candidates = parsePaths(text, options.recognizers)
  return candidates.map((candidate) => {
    const scope = pickScope(tree, candidate.kind, maxDepth, depthOf)
    // Collect the full match set (no cap), then rank and slice: ranking must see
    // every match, and the decision depends on `total`, never on `cap`.
    const { matches: allMatches, total } = scanScope(scope, segmentsOf, candidate.normalized)
    const ranked = rankMatches(allMatches, candidate.normalized)
    const matches = ranked.slice(0, Math.max(0, Math.trunc(cap))).map((entry) => entry.path)
    let resolved: string[] = []
    if (total >= 1 && total < ambiguityThreshold) {
      // The whole top relevance tier: everything tied with the top hit on
      // leaf-exactness + depth. Ranked order keeps this a contiguous prefix.
      const top = ranked[0]
      for (const entry of ranked) {
        if (entry.exact !== top.exact || entry.depth !== top.depth) break
        resolved.push(entry.path)
      }
    }
    return { candidate, matches, total, resolved }
  })
}

function pickScope(
  tree: string[],
  kind: PathKind,
  maxDepth: number,
  depthOf: Map<string, number>,
): string[] {
  if (kind === 'bare') {
    // `depthOf` is built in lockstep with `tree`, so the lookup never misses.
    return tree.filter((path) => depthOf.get(path)! <= maxDepth)
  }
  if (kind === 'dir') {
    const dirs = tree.filter((path) => path.endsWith('/'))
    return dirs.length > 0 ? dirs : tree
  }
  return tree
}

/** Scan `scope` for `query` using pre-split candidate segments. */
function scanScope(
  scope: string[],
  segmentsOf: Map<string, string[]>,
  query: string,
): { matches: string[]; total: number } {
  if (query === '' || query === '.') {
    return { matches: [], total: 0 }
  }
  const querySegments = query.split('/').filter(Boolean)
  const matches: string[] = []
  for (const candidate of scope) {
    const segments = segmentsOf.get(candidate)
    if (segments !== undefined && pathMatchesSegments(candidate, segments, query, querySegments)) {
      matches.push(candidate)
    }
  }
  return { matches, total: matches.length }
}

/** Segment count of a project-relative path (`./` counts the `.` as a segment). */
function depth(path: string): number {
  return path.split('/').filter(Boolean).length
}

/**
 * Rank matches by relevance, stable (input order is the final tie-break):
 * 1. exact leaf-name match first — a dotless query leaf that equals the
 *    candidate leaf verbatim beats an extension-stripped match (`gates` prefers
 *    `dsh-plugin-dev/gates/` over `gates.yml`);
 * 2. then shallow depth — fewer segments (closer to the project root);
 * 3. then input order.
 *
 * Returns ranked entries carrying their (exact, depth) tier so the composer can
 * slice the whole top tier — the input-order tie-break orders `matches` but is
 * never used to drop a tied candidate from the resolution set.
 *
 * Re-splits the matched set here; that is intentionally not memoized because the
 * matched set is small — the O(tree) scan/scope split is what got memoized.
 */
interface RankedMatch {
  path: string
  /** 0 = exact leaf, 1 = extension-stripped leaf (exact sorts first). */
  exact: number
  depth: number
}

function rankMatches(paths: string[], query: string): RankedMatch[] {
  const queryLeaf = query.split('/').filter(Boolean).pop() ?? ''
  return paths
    .map((path, index) => ({
      path,
      index,
      // 0 = exact leaf, 1 = extension-stripped leaf, so exact sorts first.
      exact: (path.split('/').filter(Boolean).pop() ?? '') === queryLeaf ? 0 : 1,
      depth: depth(path),
    }))
    .sort((a, b) => a.exact - b.exact || a.depth - b.depth || a.index - b.index)
    .map(({ path, exact, depth }) => ({ path, exact, depth }))
}
