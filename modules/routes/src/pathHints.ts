const HINT_COLLECT_CAP = 5

export const PATH_MISS_MESSAGE = 'Markdown route path not found.'
export const PATH_HINT_MESSAGE = 'You may mean one of these Markdown route paths.'

export interface PathHintCandidate {
  path: string
  aliases?: readonly string[]
}

export function pathMissMessage(routePath: string): string {
  return `Markdown route path not found: ${routePath}`
}

export function suggestPathHints(
  candidatePaths: Iterable<string | PathHintCandidate>,
  queryPath: string,
): string[] {
  if (queryPath === '' || queryPath === '.') return []

  const hints = new Set<string>()
  for (const candidate of candidatePaths) {
    const path = typeof candidate === 'string' ? candidate : candidate.path
    const aliases = typeof candidate === 'string' ? [] : candidate.aliases ?? []
    const matchPaths = [path, ...aliases]
    if (matchPaths.some((matchPath) => pathHintMatches(matchPath, queryPath))) {
      hints.add(path)
      if (hints.size >= HINT_COLLECT_CAP) break
    }
  }

  return [...hints]
}

function pathHintMatches(candidate: string, queryPath: string): boolean {
  if (candidate === queryPath) return false

  const candidateSegments = candidate.split('/').filter(Boolean)
  const querySegments = queryPath.split('/').filter(Boolean)
  if (querySegments.length === 0) return false

  if (candidate.endsWith(`/${queryPath}`)) return true

  const tail = candidateSegments.slice(-querySegments.length)
  if (tail.length !== querySegments.length) return false

  const queryLeaf = querySegments[querySegments.length - 1]
  if (queryLeaf.includes('.')) {
    return tail.join('/') === queryPath
  }

  tail[tail.length - 1] = stripLeafExtension(tail[tail.length - 1])
  if (tail.join('/') === queryPath) return true

  const candidateLeaf = tail[tail.length - 1].toLowerCase()
  const normalizedQueryLeaf = queryLeaf.toLowerCase()
  return normalizedQueryLeaf.length >= 2 && candidateLeaf.includes(normalizedQueryLeaf)
}

function stripLeafExtension(segment: string): string {
  if (/^\.+$/u.test(segment)) return segment
  const dot = segment.lastIndexOf('.')
  if (dot <= 0) return segment
  return segment.slice(0, dot)
}
