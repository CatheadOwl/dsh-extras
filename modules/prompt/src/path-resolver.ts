import { resolvePromptPaths } from './parse/index.js'
import type { ResolvePromptPathsOptions } from './parse/index.js'
import { enumerateWorkspacePaths } from './tree/index.js'

import type { PromptMiddlewareTraceEvent, ResolvedPromptPath } from './types.js'

export interface ResolvePromptPathListOptions extends ResolvePromptPathsOptions {
  candidatePaths?: string[]
  trace?: PromptMiddlewareTraceEvent[]
}

export async function resolvePromptPathList(
  prompt: string,
  cwd: string,
  options: ResolvePromptPathListOptions = {},
): Promise<ResolvedPromptPath[]> {
  const candidatePaths = options.candidatePaths ?? await enumerateWorkspacePaths(cwd)
  const mentions = resolvePromptPaths(prompt, candidatePaths, options)
  const seen = new Set<string>()
  const out: ResolvedPromptPath[] = []
  for (const mention of mentions) {
    if (mention.resolved.length === 0) {
      options.trace?.push({
        provider: 'path-resolver',
        status: 'skipped',
        reason: `unresolved mention ${JSON.stringify(mention.candidate.raw)} with ${mention.total} candidate(s)`,
      })
      continue
    }
    // A mention may resolve to the whole top relevance tier (same-name,
    // same-depth ties) — emit one `ResolvedPromptPath` per resolved path so the
    // relates providers see every tied target, not an arbitrary input-order winner.
    for (const resolved of mention.resolved) {
      const isDirectory = resolved.endsWith('/')
      const path = isDirectory ? resolved.replace(/\/+$/u, '') : resolved
      if (seen.has(path)) {
        options.trace?.push({
          provider: 'path-resolver',
          status: 'skipped',
          reason: `duplicate path ${JSON.stringify(path)} discarded`,
        })
        continue
      }
      seen.add(path)
      out.push({
        path,
        kind: isDirectory ? 'directory' : 'file',
        origin: 'prompt-parse',
        mention: {
          raw: mention.candidate.raw,
          normalized: mention.candidate.normalized,
          kind: mention.candidate.kind,
          start: mention.candidate.start,
          end: mention.candidate.end,
          total: mention.total,
        },
      })
    }
  }
  return out
}
