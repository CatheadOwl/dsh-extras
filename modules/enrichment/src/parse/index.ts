/**
 * @catheadowl/dsh-prompt-parse — pure user-prompt path extraction for dsh.
 * Non-plugin, non-service: two pure primitives (parse + fuzzy) and one
 * composer (resolve) that carries the decision policy; zero runtime deps.
 */
// `pathMatchesSegments` is a module-internal memoization building block used by
// resolve.ts; it is deliberately NOT re-exported. The public fuzzy primitive is
// `suggestPathCandidates`.
export { suggestPathCandidates, type PathCandidateMatches } from './fuzzy.js'
export * from './parse.js'
export * from './resolve.js'
