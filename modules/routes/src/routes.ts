import {
  flattenRoutesProjection,
  projectRoutesEntries,
  routeProjectionLineText,
  selectRouteSubtree,
} from './projection.js'
import { PATH_HINT_MESSAGE, pathMissMessage, suggestPathHints } from './pathHints.js'
import { isPathUnderLexical } from './path.js'
import { collectMarkdownEntries, collectRouteHintCandidates } from './scanner.js'
import type { AnyRoutesResult, RouteDiagnostic, RoutesFormat } from './types.js'
import { stat } from 'node:fs/promises'
import path from 'node:path'

export async function buildAnyRoutes(
  root: string,
  options: {
    routePath?: string
    depth: number
    format: RoutesFormat
    excludeDirs: readonly string[]
    excludeFiles: readonly string[]
    excludeDotEntries: boolean
    maxFiles: number
    respectGitignore: boolean
  },
): Promise<AnyRoutesResult> {
  const diagnostics: RouteDiagnostic[] = []
  const requestedRoutePath = options.routePath ? normalizedRoutePath(options.routePath) : undefined
  let resolved = await resolveScanRoot(root, requestedRoutePath)

  if (resolved.escaped) {
    return {
      root,
      anchor: root,
      generatedAt: Date.now(),
      depth: options.depth,
      format: options.format,
      routePath: requestedRoutePath,
      routeCount: 0,
      diagnostics: [{
        code: 'route-path-escaped',
        severity: 'warning',
        message: `Route path ${requestedRoutePath} escapes the scan root ${root}; refusing to scan outside the workspace.`,
        path: requestedRoutePath,
      }],
      routes: [],
    }
  }

  let pathHints: string[] = []
  let resolvedRoutePath: string | undefined

  if (resolved.missed && requestedRoutePath) {
    pathHints = suggestPathHints(await collectRouteHintCandidates(root, {
      excludeDirs: options.excludeDirs,
      excludeFiles: options.excludeFiles,
      excludeDotEntries: options.excludeDotEntries,
      maxFiles: options.maxFiles,
      maxDepth: options.depth,
      respectGitignore: options.respectGitignore,
    }, diagnostics), requestedRoutePath)

    if (pathHints.length === 1) {
      resolvedRoutePath = pathHints[0]
      resolved = await resolveScanRoot(root, resolvedRoutePath)
      pathHints = []
    }
  }

  const entries = await collectMarkdownEntries(root, {
    scanRoot: resolved.scanRoot,
    excludeDirs: options.excludeDirs,
    excludeFiles: options.excludeFiles,
    excludeDotEntries: options.excludeDotEntries,
    maxFiles: options.maxFiles,
    maxDepth: options.depth,
    respectGitignore: options.respectGitignore,
  }, diagnostics)
  const tree = projectRoutesEntries(entries)
  const effectiveRoutePath = resolvedRoutePath ?? requestedRoutePath
  const selectedTree = effectiveRoutePath ? selectRouteSubtree(tree, effectiveRoutePath) : tree
  const result: AnyRoutesResult = {
    root,
    anchor: resolved.scanRoot,
    generatedAt: Date.now(),
    depth: options.depth,
    format: options.format,
    ...(requestedRoutePath ? { routePath: requestedRoutePath } : {}),
    ...(resolvedRoutePath ? { resolvedRoutePath } : {}),
    ...(resolved.missed && requestedRoutePath
      ? { pathMissMessage: pathMissMessage(requestedRoutePath) }
      : {}),
    ...(pathHints.length > 0 ? { pathHintMessage: PATH_HINT_MESSAGE, pathHints } : {}),
    routeCount: entries.length,
    diagnostics,
  }

  if (options.format === 'tree') {
    result.tree = selectedTree
  } else {
    result.routes = flattenRoutesProjection(selectedTree).map(routeProjectionLineText)
  }

  return result
}

async function resolveScanRoot(
  root: string,
  routePath: string | undefined,
): Promise<{ scanRoot: string; missed: boolean; escaped: boolean }> {
  if (!routePath || routePath === '.') return { scanRoot: root, missed: false, escaped: false }

  const candidate = path.resolve(root, routePath)
  if (!isPathUnderLexical(candidate, root)) return { scanRoot: candidate, missed: true, escaped: true }
  if (await isDirectory(candidate)) return { scanRoot: candidate, missed: false, escaped: false }

  return { scanRoot: candidate, missed: true, escaped: false }
}

async function isDirectory(value: string): Promise<boolean> {
  try {
    return (await stat(value)).isDirectory()
  } catch {
    return false
  }
}

function normalizedRoutePath(routePath: string): string {
  return routePath.replace(/\\/g, '/').replace(/^\/+|\/+$/gu, '') || '.'
}
