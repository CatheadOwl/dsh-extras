/**
 * Fuzzy path-candidate suggestion for user-prompt parsing.
 *
 * `prompt-parse` never decides which candidate is "the" path — it only ranks
 * how well each extracted token matches the project's real paths. This module
 * is the pure matcher: segment-suffix matching plus a dotless-leaf
 * extension-stripping rule, ported from CogGit's `pathHints` with three
 * adaptations for the prompt-parsing shape:
 *
 * - `cap` is a parameter, not a hardcoded constant.
 * - An exact match is a hit. CogGit's `pathHints` excluded it because it only
 *   ran after a miss; here every extracted token is matched, exact included.
 * - `candidatePaths` may include directories, so a bare `handbooks` query
 *   matches `handbooks/`, `topics/handbooks/`, … at any depth.
 *
 * Matching rules (segments split on `/`), two modes:
 * - Unanchored (project-relative query, no leading `/`): the query's segments
 *   must equal a trailing slice of the candidate's. A query leaf with no dot
 *   (`registry`) may match a candidate leaf that carries a file extension
 *   (`src/registry.ts`) — the leaf is extension-stripped. A query leaf that
 *   already names an extension (`registry.ts`) must match a leaf named exactly
 *   that (never `registry.ts.md`). Hidden files (`.gitignore`) are never
 *   extension-stripped on either side.
 * - Root-anchored (repository-root-relative citation, leading `/`, kept by
 *   parse normalization): the query is pinned to the repository root, so the
 *   candidate must be an exact full-position match — every segment equal, no
 *   trailing slice, no extension stripping. `/README.md` names the root
 *   `README.md` only (never `a/README.md`); `/docs` never matches `docs.md`.
 *   A directory candidate's trailing `/` is not a segment, so `/handbooks`
 *   and `/handbooks/` both name the root node `handbooks/`.
 */

export interface PathCandidateMatches {
  /** First `cap` matching paths, in input order, de-duplicated. */
  matches: string[]
  /** Total hit count (de-duplicated), never truncated — the caller's ambiguity signal. */
  total: number
}

/**
 * Suggest project paths matching `query`.
 *
 * An unanchored query (no leading `/`) matches by trailing segments, with
 * dotless-leaf extension stripping; a root-anchored query (leading `/`, the
 * repository-root-relative citation form) matches exactly by full position —
 * see `pathMatchesSegments`.
 *
 * `matches` holds at most `cap` entries; `total` always reports the full,
 * de-duplicated hit count so the caller can distinguish a unique hit
 * (`total === 1`) from an ambiguous one (`total > 1`) even when `cap = 1`.
 * A `cap < 1` (after truncating toward zero) returns an empty `matches` while
 * `total` still counts.
 *
 * Usage (decision is the consumer's, never this function's):
 *
 * ```ts
 * const { matches, total } = suggestPathCandidates(candidatePaths, query, cap)
 * if (total === 0) {} // not a path
 * else if (total === 1) {} // unique: use matches[0]
 * else {} // ambiguous: pick one / top-N / drop
 * ```
 */
export function suggestPathCandidates(
  candidatePaths: Iterable<string>,
  query: string,
  cap = 5,
): PathCandidateMatches {
  if (query === '' || query === '.') {
    return { matches: [], total: 0 }
  }
  const capValue = Math.max(0, Math.trunc(cap))
  const seen = new Set<string>()
  const matches: string[] = []
  let total = 0
  for (const candidate of candidatePaths) {
    if (!pathCandidateMatches(candidate, query) || seen.has(candidate)) {
      continue
    }
    seen.add(candidate)
    total += 1
    if (matches.length < capValue) {
      matches.push(candidate)
    }
  }
  return { matches, total }
}

/**
 * Whether `candidate` matches `query` given their precomputed segments. This is
 * the memoizable core of `suggestPathCandidates`: splitting is the per-candidate
 * cost `resolvePromptPaths` amortizes across mentions by calling this directly
 * with one set of pre-split segments.
 *
 * @internal — module-internal building block, not re-exported by the package
 * barrel (`index.ts`). Use `suggestPathCandidates` for one-off queries.
 */
export function pathMatchesSegments(
  candidate: string,
  candidateSegments: string[],
  query: string,
  querySegments: string[],
): boolean {
  if (querySegments.length === 0) {
    return false
  }

  // Root-anchored query (the repository-root-relative citation form): the
  // leading `/` pins the path to the repository root, so matching is exact
  // full-position equality — every segment, no trailing slice, no extension
  // stripping. This branch must precede the `endsWith('/' + query)` shortcut:
  // `/workunits/md-fabric` must NOT tail-match `x/workunits/md-fabric`.
  if (query.startsWith('/')) {
    if (candidateSegments.length !== querySegments.length) {
      return false
    }
    return candidateSegments.every((segment, i) => segment === querySegments[i])
  }

  if (candidate.endsWith(`/${query}`)) {
    return true
  }

  const tail = candidateSegments.slice(-querySegments.length)
  if (tail.length !== querySegments.length) {
    return false
  }

  const queryLeaf = querySegments[querySegments.length - 1]
  if (queryLeaf.includes('.')) {
    return tail.join('/') === query
  }

  tail[tail.length - 1] = stripLeafExtension(tail[tail.length - 1])
  return tail.join('/') === query
}

function pathCandidateMatches(candidate: string, query: string): boolean {
  return pathMatchesSegments(
    candidate,
    candidate.split('/').filter(Boolean),
    query,
    query.split('/').filter(Boolean),
  )
}

/**
 * Strip a trailing file extension from one segment. Hidden files (`.gitignore`)
 * and all-dot names are left unchanged, mirroring CogGit's `pathHints`.
 */
function stripLeafExtension(segment: string): string {
  if (/^\.+$/u.test(segment)) {
    return segment
  }
  const dot = segment.lastIndexOf('.')
  if (dot <= 0) {
    return segment
  }
  return segment.slice(0, dot)
}
