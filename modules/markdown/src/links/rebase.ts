/**
 * Rebase seam (self-written — the host verifies but never rewrites,
 * so there is no host equivalent to fork). Byte-preserving destination rewrite:
 * replace only the destination substring of one reference, keeping the
 * fragment/query suffix and every other byte. The offset-rewrite pattern
 * follows upstream `translation-links.ts`, but this function is
 * self-written.
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
