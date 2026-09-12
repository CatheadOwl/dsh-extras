/**
 * Rebase seam (self-written — the host verifies but never rewrites,
 * so there is no host equivalent to fork). Byte-preserving rewrite of one
 * reference: replace only the destination substring, or only the label
 * substring, keeping the fragment/query suffix and every other byte. Callers
 * that rewrite both (a mirrored label — see `relabelFor`) splice the
 * destination first: inside one reference the label range always sits strictly
 * BEFORE the destination range, so descending-offset order keeps every
 * remaining offset valid. The offset-rewrite pattern follows upstream
 * `translation-links.ts`, but these functions are self-written.
 */
import { splitMarkdownUrlTarget } from './markdown.js'
import type { LinkReference } from './resolve.js'

/**
 * Rewrite one reference's destination in `source`, preserving the fragment /
 * query suffix and every other byte. The reference must carry byte offsets from
 * `extractReferences` (via `markdownDestination`), never a re-serialized
 * position — this is the byte-preserving contract.
 * @param source - the document the reference was extracted from.
 * @param reference - the located reference whose destination changes.
 * @param newPath - the replacement destination path (its suffix is preserved).
 * @returns the source with exactly the destination substring replaced.
 */
export function rebaseDestination(source: string, reference: LinkReference, newPath: string): string {
  if (reference.start === undefined || reference.end === undefined) {
    throw new Error('rebaseDestination requires a reference with byte offsets (autolinks and bare URLs are not rebasable)')
  }
  const { suffix } = splitMarkdownUrlTarget(reference.url)
  return source.slice(0, reference.start) + newPath + suffix + source.slice(reference.end)
}

/**
 * Rewrite one reference's label in `source`, byte-preserving everything else
 * (the destination, the brackets, the rest of the document). The reference must
 * carry a located label from `extractReferences` — definitions, markup labels,
 * and forms with no label range are not relabelable and fail fast rather than
 * guess a range.
 * @param source - the document the reference was extracted from.
 * @param reference - the located reference whose label changes.
 * @param newLabel - the replacement label text (no brackets; written verbatim).
 * @returns the source with exactly the label substring replaced.
 */
export function rebaseLabel(source: string, reference: LinkReference, newLabel: string): string {
  const label = reference.label
  if (label === undefined) {
    throw new Error('rebaseLabel requires a reference with a located label (definitions, markup labels, and link forms without one are not relabelable)')
  }
  return source.slice(0, label.start) + newLabel + source.slice(label.end)
}
