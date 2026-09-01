/**
 * @catheadowl/dsh-md-links — pure Markdown link-integrity data plane.
 * Parse seam: `src/markdown.ts` (fork of upstream scripts/markdown.ts).
 * Anchor seam: `src/anchors.ts` (fork of upstream scripts/verify-md-links.ts).
 * Resolve seam: `src/resolve.ts` (self-written, aligned with upstream semantics).
 * Git seam: `src/git.ts` (self-written; host uses glob, not git).
 * Provenance split (fork vs self-written): `workunits/md-links/ADR/0002`.
 * Contracts: `workunits/md-links/spec/canonical-lib.md` (唯一说法).
 * @module @catheadowl/dsh-md-links
 */
export {
  parseMarkdown,
  visitMarkdown,
  markdownDestination,
  splitMarkdownUrlTarget,
  isExternalOrAbsoluteMarkdownUrl,
  markdownHeadingLines,
} from './markdown.js'
export type { MarkdownDestination, MarkdownDestinationNode, MarkdownHeadingLine, MarkdownProseLine } from './markdown.js'
export { githubSlug, documentAnchors, documentAnchorPairs, anchorCache } from './anchors.js'
export type { DocumentAnchorPair } from './anchors.js'
export {
  gitTopLevel,
  gitLinkPaths,
  gitLsFiles,
  gitGrep,
  gitMove,
  captureGitStdout,
  gitStatusPorcelain,
  gitTreeHas,
} from './git.js'
export type { GitLsFiles, GitStatusRecord } from './git.js'
export {
  REASON_ANCHOR_MISSING,
  pathInside,
  posixRelative,
  canonicalPath,
  collectAllFiles,
  collectMarkdownSources,
  repositoryRoot,
  extractReferences,
  resolveReference,
  resolveReferenceLexically,
  checkRepository,
} from './resolve.js'
export type { CheckRepositoryOptions, LinkReference, Resolution, LinkViolation, ReferenceKind } from './resolve.js'
export { rebaseDestination } from './rebase.js'
export { rebaseHref, planRename, applyRenamePlan, REASON_NO_RENAME_EVIDENCE } from './rename.js'
export type {
  RenameSkip,
  RenameConflict,
  RenamePlan,
  RenamePlanResult,
  RenameApplyResult,
} from './rename.js'
export { planRootRelativeNormalization, applyRootRelativeNormalization } from './normalize.js'
export type {
  RootRelativeRewrite,
  RootRelativeSkip,
  RootRelativePlan,
  RootRelativeApplyResult,
} from './normalize.js'
