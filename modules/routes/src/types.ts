export interface RouteDiagnostic {
  code: string
  severity: 'info' | 'warning'
  message: string
  path?: string
}

export interface MarkdownRouteEntry {
  path: string
  markdownPath: string
  kind: 'file' | 'folder'
  description: string | null
  /** True when this folder was cut off by the scan depth limit; its children were not read. */
  truncated?: boolean
  /** Recursive .md file count under a truncated folder (the unexpanded .md total). */
  omittedMarkdownCount?: number
  diagnostics: RouteDiagnostic[]
}

export interface RoutesProjectionNode {
  path: string
  /** README path representing a truncated folder; absent on file and structural nodes. */
  markdown?: string
  kind?: 'file' | 'folder'
  description?: string
  truncated?: boolean
  /** Recursive .md file count under a truncated folder (the unexpanded .md total). */
  omittedMarkdownCount?: number
  children?: RoutesProjectionNode[]
}

export type RoutesFormat = 'flat' | 'tree'

export interface AnyRoutesResult {
  root: string
  /** Absolute path the routing view is anchored at (root + resolved routePath); depth is measured from here. */
  anchor: string
  generatedAt: number
  depth: number
  format: RoutesFormat
  routePath?: string
  resolvedRoutePath?: string
  pathMissMessage?: string
  pathHintMessage?: string
  pathHints?: string[]
  /** Number of route entries produced (Markdown files plus truncated folders), not a raw file count. */
  routeCount: number
  diagnostics: RouteDiagnostic[]
  routes?: string[]
  tree?: RoutesProjectionNode[]
}
