/**
 * The generic `doc-link` gate surface: every internal Markdown reference
 * (link, image, definition) must resolve to an existing target and, for
 * Markdown targets, a valid heading anchor. Reuses the md-links pure lib
 * (`checkRepository`) — this module is the shape adapter plus the turn-end
 * attribution predicate. For
 * anchor-missing violations the remedy guidance carries a deterministic hint:
 * the target's headings whose slug shares the longest prefix with the failed
 * fragment, each with its exact `#anchor`, so the model can claim the heading
 * it meant without knowing the slug rules.
 *
 * Lineage: this is the former repo-level thin shim
 * `scripts/doc-link-lib.mjs`, now shipped inside the md-links-gates plugin so every project gets the same
 * data plane without copying a shim. `check(root, changes?)` keeps the generic
 * module-gate surface (`gates.yml` `module:` form and the plugin's
 * `registerGate` definition both load it).
 *
 * External targets (`//`, `/`, scheme) and fragments onto non-Markdown targets
 * are out of scope and never flagged (md-links semantics).
 */
import { readFileSync } from 'node:fs'
import { REASON_ANCHOR_MISSING, canonicalPath, checkRepository, documentAnchorPairs } from './links/index.js'
import type { LinkViolation } from './links/index.js'
import type { GateChangeSet, GateViolation } from '@catheadowl/dsh-extras/register'

const MANUAL_REMEDY = {
  kind: 'manual' as const,
  guidance:
    'Repair the reference so its target file and #fragment resolve (document-relative path; '
    + '//, /, and scheme targets are skipped), or create/move the target it points to.',
}

/** Maximum hint lines appended to an anchor-missing remedy guidance. */
const MAX_ANCHOR_HINTS = 3

/** Longest shared prefix length — the deterministic ranking key for anchor hints. */
function commonPrefixLength(a: string, b: string): number {
  let length = 0
  while (length < a.length && length < b.length && a[length] === b[length]) length += 1
  return length
}

/** The percent-decoded `#fragment` of a link target (query stripped); raw on a malformed escape. */
function fragmentOf(url: string): string {
  const hash = url.indexOf('#')
  if (hash === -1) return ''
  const raw = url.slice(hash + 1).replace(/\?.*$/, '')
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * Deterministic repair hint for one broken anchor: the target's headings whose
 * slug shares the longest prefix with the failed fragment, tie-broken by
 * document order, each shown with its rendered heading text and exact
 * `#anchor`. The model claims the heading it meant and copies the fragment —
 * no slug-rule knowledge required. Headings only: explicit `<a id="…">`
 * anchors are never hinted (they have no heading text to present). Empty when
 * the target is unreadable or nothing shares a prefix.
 */
function anchorHints(fragment: string, targetAbs: string | undefined): string {
  if (targetAbs === undefined || !targetAbs.toLowerCase().endsWith('.md')) return ''
  let pairs
  try {
    pairs = documentAnchorPairs(readFileSync(targetAbs, 'utf8'))
  } catch {
    return ''
  }
  const scored = pairs
    .map(pair => ({ pair, score: commonPrefixLength(fragment, pair.anchor) }))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.pair.heading.index - b.pair.heading.index)
    .slice(0, MAX_ANCHOR_HINTS)
  if (scored.length === 0) return ''
  const lines = scored.map(({ pair }) => `- ${JSON.stringify(pair.heading.text)} → #${pair.anchor}`)
  return ` The #fragment matches no anchor in this document; the heading(s) whose slug shares the longest prefix with it:\n${lines.join('\n')}`
}

/**
 * Build the attribution predicate from a gate change set. `root` is the
 * session workspace cwd, the resolution base for raw `file_path` entries.
 * Canonicalized through md-links `canonicalPath` so membership is exact.
 */
function buildAttributionPredicate(root: string, changes: GateChangeSet) {
  const written = new Set((changes.paths ?? []).map(path => canonicalPath(path, root)))
  const opaque = changes.opaque === true
  return (sourceFile: string, targetAbs?: string): boolean => {
    if (opaque) return true
    if (written.has(sourceFile)) return true
    if (targetAbs !== undefined && written.has(targetAbs)) return true
    return false
  }
}

function toGateViolation(violation: LinkViolation): GateViolation {
  const reason = `unresolved Markdown reference ${JSON.stringify(violation.url)} (${violation.reason})`
  const guidance = violation.reason === REASON_ANCHOR_MISSING
    ? MANUAL_REMEDY.guidance + anchorHints(fragmentOf(violation.url), violation.targetAbs)
    : MANUAL_REMEDY.guidance
  return {
    file: violation.file,
    line: violation.line,
    reason,
    remedy: { kind: 'manual', guidance },
  }
}

/** Generic gate surface: full scan, then (stop 档) filter to session-attributable violations. */
export function check(root: string, changes?: GateChangeSet): GateViolation[] {
  const options = changes === undefined
    ? undefined
    : { include: buildAttributionPredicate(root, changes) }
  return checkRepository(root, options).map(toGateViolation)
}
