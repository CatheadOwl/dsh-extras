/**
 * Fork of the anchor primitives in `deepseek-harness/scripts/verify-md-links.ts`
 * (upstream anchor SSOT) — copied so md-links keeps the same anchor algorithm
 * without importing upstream source. Upstream sync: re-copy `githubSlug` /
 * `documentAnchors` / `anchorCache` by hand when the upstream file changes them,
 * then re-run `pnpm run test`.
 */

import { readFileSync } from 'node:fs'
import type { Nodes } from 'mdast'

import { markdownHeadingLines, parseMarkdown, visitMarkdown, type MarkdownHeadingLine } from './markdown.js'

/**
 * GitHub's heading-slug algorithm (lowercase; drop everything but letters,
 * numbers, underscores, spaces, hyphens; spaces become hyphens).
 * @param heading - the RENDERED heading text (Markdown syntax already gone).
 * @returns the anchor GitHub assigns the first occurrence of the heading.
 */
export function githubSlug(heading: string): string {
  return heading.toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, '').replaceAll(' ', '-')
}

/**
 * Every anchor one Markdown document exposes: each heading's GitHub slug plus
 * every explicit `<a id="…">` in real HTML flow. Repeated slugs get GitHub's
 * occupied-set `-1`, `-2`, … suffixes. Matching is exact — ids are case-sensitive.
 * @param source - the document's full Markdown text.
 * @returns the set of valid fragments for links into this document.
 */
export function documentAnchors(source: string): Set<string> {
  const anchors = new Set<string>()
  const occurrences = new Map<string, number>()
  for (const heading of markdownHeadingLines(source)) {
    const base = githubSlug(heading.text)
    let result = base
    let bump = occurrences.get(base) ?? 0
    while (anchors.has(result)) {
      bump += 1
      result = `${base}-${bump}`
    }
    occurrences.set(base, bump)
    anchors.add(result)
  }
  visitMarkdown(parseMarkdown(source), (node: Nodes): void => {
    if (node.type !== 'html') return
    const html = node.value.replace(/<!--[\s\S]*?-->/g, '')
    for (const match of html.matchAll(/<a id="([^"]+)"/g)) anchors.add(match[1] ?? '')
  })
  return anchors
}

/** One heading and the exact fragment it exposes (bump-suffixed when repeated). */
export interface DocumentAnchorPair {
  heading: MarkdownHeadingLine
  anchor: string
}

/**
 * Extension (not upstream — self-written on top of the forked primitives):
 * every heading paired with the exact anchor it exposes, in document order,
 * using the same occupied-set bumping as `documentAnchors`. Headings only —
 * explicit `<a id="…">` anchors are exposed by `documentAnchors` but have no
 * heading text to pair, so hint consumers must treat them as unpairable.
 * @param source - the document's full Markdown text.
 * @returns heading → anchor pairs, one per heading, document-ordered.
 */
export function documentAnchorPairs(source: string): DocumentAnchorPair[] {
  const pairs: DocumentAnchorPair[] = []
  const anchors = new Set<string>()
  const occurrences = new Map<string, number>()
  for (const heading of markdownHeadingLines(source)) {
    const base = githubSlug(heading.text)
    let result = base
    let bump = occurrences.get(base) ?? 0
    while (anchors.has(result)) {
      bump += 1
      result = `${base}-${bump}`
    }
    occurrences.set(base, bump)
    anchors.add(result)
    pairs.push({ heading, anchor: result })
  }
  return pairs
}

/**
 * Lazily collect and cache the anchor set of any existing Markdown file —
 * shared across all scanned sources so a target parses once.
 * @returns the memoized absolute-path → anchor-set lookup.
 */
export function anchorCache(): (absPath: string) => Set<string> {
  const cache = new Map<string, Set<string>>()
  return (absPath) => {
    const hit = cache.get(absPath)
    if (hit) return hit
    const anchors = documentAnchors(readFileSync(absPath, 'utf8'))
    cache.set(absPath, anchors)
    return anchors
  }
}
