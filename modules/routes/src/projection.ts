import { normalizeRoutePath } from './path.js'
import type { MarkdownRouteEntry, RoutesProjectionNode } from './types.js'

export function projectRoutesEntries(entries: readonly MarkdownRouteEntry[]): RoutesProjectionNode[] {
  const roots: MutableRoutesProjectionNode[] = []

  for (const entry of entries) {
    const segments = pathSegments(entry.path)
    if (segments.length === 0) continue

    let siblings = roots
    const currentPath: string[] = []
    for (const segment of segments) {
      currentPath.push(segment)
      const nodePath = currentPath.join('/')
      let node = siblings.find((candidate) => candidate.path === nodePath)
      if (!node) {
        node = { path: nodePath, children: [] }
        siblings.push(node)
        siblings.sort((left, right) => left.path.localeCompare(right.path))
      }
      siblings = node.children
    }

    const node = findRouteTreeNode(roots, segments)
    if (node) {
      if (entry.kind === 'folder' && entry.markdownPath) node.markdown = entry.markdownPath
      node.kind = entry.kind
      if (entry.description) node.description = entry.description
      if (entry.truncated) {
        node.truncated = true
        node.omittedMarkdownCount = entry.omittedMarkdownCount
      }
    }
  }

  return roots.map(finalizeRouteTreeNode)
}

export function selectRouteSubtree(
  nodes: readonly RoutesProjectionNode[],
  routePath?: string,
): RoutesProjectionNode[] {
  const normalizedRoutePath = normalizeRoutePath(routePath)
  if (!normalizedRoutePath || normalizedRoutePath === '.') return [...nodes]

  const result: RoutesProjectionNode[] = []
  for (const node of nodes) {
    if (node.path === normalizedRoutePath) return [node]
    if (normalizedRoutePath.startsWith(node.path + '/')) {
      const selectedChildren = node.children ? selectRouteSubtree(node.children, normalizedRoutePath) : []
      if (selectedChildren.length > 0) return selectedChildren
    } else if (node.path.startsWith(normalizedRoutePath + '/')) {
      result.push(node)
    }
  }
  return result
}

export function flattenRoutesProjection(nodes: readonly RoutesProjectionNode[]): RoutesProjectionNode[] {
  return nodes.flatMap((node) => [
    ...(isStructuralOnly(node) ? [] : [node]),
    ...(node.children ? flattenRoutesProjection(node.children) : []),
  ])
}

/**
 * A structural-only node carries hierarchy but no navigable entry: it has
 * children, yet no markdown, no truncated marker, no description, and no kind.
 * It is the path leading to real entries (e.g. the selected route root or an
 * expanded folder with a README), so flat output skips it — its children still
 * flatten under namespaced paths.
 */
function isStructuralOnly(node: RoutesProjectionNode): boolean {
  return node.children !== undefined
    && node.children.length > 0
    && node.markdown === undefined
    && node.truncated !== true
    && node.description === undefined
    && node.kind === undefined
}

export function routeProjectionLineText(route: RoutesProjectionNode): string {
  const prefix = route.truncated
    ? `[truncated: ${route.omittedMarkdownCount ?? 0}] `
    : ''
  // Every route line is named by `path`: a file's `path` is its full `.md`
  // path, a folder's `path` is its directory path.
  const target = route.path
  return route.description
    ? `${prefix}${target} | ${route.description}`
    : `${prefix}${target}`
}

interface MutableRoutesProjectionNode {
  path: string
  markdown?: string
  kind?: 'file' | 'folder'
  description?: string
  truncated?: boolean
  omittedMarkdownCount?: number
  children: MutableRoutesProjectionNode[]
}

function pathSegments(route: string): string[] {
  if (route === '.') return ['.']
  return route.split('/').filter((segment) => segment.length > 0 && segment !== '.')
}

function findRouteTreeNode(
  roots: MutableRoutesProjectionNode[],
  segments: readonly string[],
): MutableRoutesProjectionNode | undefined {
  let node: MutableRoutesProjectionNode | undefined
  let siblings = roots
  const currentPath: string[] = []

  for (const segment of segments) {
    currentPath.push(segment)
    node = siblings.find((candidate) => candidate.path === currentPath.join('/'))
    if (!node) return undefined
    siblings = node.children
  }

  return node
}

function finalizeRouteTreeNode(node: MutableRoutesProjectionNode): RoutesProjectionNode {
  return {
    path: node.path,
    ...(node.markdown ? { markdown: node.markdown } : {}),
    ...(node.kind ? { kind: node.kind } : {}),
    ...(node.description ? { description: node.description } : {}),
    ...(node.truncated ? { truncated: true } : {}),
    ...(node.omittedMarkdownCount !== undefined ? { omittedMarkdownCount: node.omittedMarkdownCount } : {}),
    ...(node.children.length > 0 ? { children: node.children.map(finalizeRouteTreeNode) } : {}),
  }
}
