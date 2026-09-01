import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

import { registerBreadcrumbDescriptionProvider } from './breadcrumb-description.js'
import { resolveRoot } from './path.js'
import { buildAnyRoutes } from './routes.js'
import type { RoutesFormat } from './types.js'

export interface Config {
  /**
   * Default scan root, expressed as a sub-path of the calling session's
   * workspace. The workspace itself is a runtime fact (session cwd), never a
   * call argument; `routePath` then selects within this root.
   */
  root?: string
  /**
   * Directory names skipped during traversal.
   */
  excludeDirs?: string[]
  /**
   * Whether traversal skips dot entries (names starting with '.') such as .github or .agents.
   */
  excludeDotEntries?: boolean
  /**
   * Maximum files read per invocation.
   */
  maxFiles?: number
  /**
   * Whether traversal should respect .gitignore files.
   */
  respectGitignore?: boolean
}

const DEFAULT_EXCLUDE_DIRS = [
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.pnpm',
  'dist',
  'build',
  'lib',
  'out',
]

export const name = 'any_routes'
export const inject = ['tools']

export const Config: z<Config> = z.object({
  root: z.string().default('.'),
  excludeDirs: z.array(z.string()).default(DEFAULT_EXCLUDE_DIRS),
  excludeDotEntries: z.boolean().default(true),
  maxFiles: z.number().default(2000),
  respectGitignore: z.boolean().default(true),
})

/** Model-facing tool description, exported so contract tests can assert on it (truncated-folder `| description`, never-file-content boundary, no next-hints). */
export const ANY_ROUTES_DESCRIPTION =
  'Build a routing view from Markdown descriptions under a directory: folders are represented by their README.md (its description, when present). Use before exploring an unfamiliar Markdown knowledge base to pick a folder route. Route lines are always workspace-root-relative full paths (e.g. `explorer/sandbox-containment/containment.md`), never relative to the selected route root, and are sorted case-insensitively by route path. Every line is either a Markdown file route (with ` | description` when the file has one) or a depth-truncated folder rendered as `[truncated: N] folder-path` (with ` | description` when the folder\u2019s README has one), where N is the folder\u2019s recursive .md count (the total that would expand on descent). `routeCount` counts route entries (files plus truncated folders), not raw .md files or structural tree nodes. Returns route paths and descriptions, never file content.'

export function apply(ctx: Context, config: Config): void {
  const defaultRoot = config.root ?? '.'
  const defaultExcludeDirs = config.excludeDirs ?? DEFAULT_EXCLUDE_DIRS
  const defaultExcludeDotEntries = config.excludeDotEntries ?? true
  const defaultMaxFiles = config.maxFiles ?? 2000
  const defaultRespectGitignore = config.respectGitignore ?? true

  registerBreadcrumbDescriptionProvider(ctx, {
    root: defaultRoot,
    excludeDirs: defaultExcludeDirs,
    excludeDotEntries: defaultExcludeDotEntries,
    respectGitignore: defaultRespectGitignore,
  })

  ctx.tools.register(defineTool({
    name: 'any_routes',
    description: ANY_ROUTES_DESCRIPTION,
    parameters: {
      routePath: {
        type: 'string',
        description: 'Optional folder route to scan from. "." scans from the root. Use slash-separated folder paths such as Topics, handbooks, or explorer/dsh-plugin-dev; do not pass a Markdown file route.',
      },
      depth: {
        type: 'integer',
        description: 'Maximum directory depth to expand below the route root (routePath if given, otherwise the workspace root). Depth is measured from that route root, not the workspace root. A folder sitting exactly at the depth boundary is not descended into and is shown as `[truncated: N] folder-path` instead of expanding. Defaults to 0: lists only the route root\u2019s own Markdown files plus each direct sub-folder as its `[truncated: N]` representative.',
      },
      format: {
        type: 'string',
        enum: ['flat', 'tree'],
        description: 'Output shape. `flat` (default) returns one route line per entry. `tree` returns nested nodes with the same semantics: a file node has its full `.md` path in `path` and `kind: file`; a truncated folder has `path`, `kind: folder`, `truncated: true`, `omittedMarkdownCount` (the recursive .md total), and `markdown` (its README path); an expanded folder has only `path` and `children`.',
      },
      excludeDirs: {
        type: 'string',
        description: 'Directory names skipped during traversal. Defaults to the plugin config.',
      },
      excludeDotEntries: {
        type: 'boolean',
        description: 'Whether to skip dot entries (names starting with ".") such as .github or .agents. Defaults to true.',
      },
      maxFiles: {
        type: 'integer',
        description: 'Maximum Markdown files to read. Defaults to plugin config maxFiles.',
      },
      respectGitignore: {
        type: 'boolean',
        description: 'Whether to skip paths ignored by .gitignore files during traversal. Defaults to true.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      const root = resolveRoot(defaultRoot, exec.agent?.session.header.cwd)
      const depth = integerOrDefault(args.depth, 0)
      const format = (args.format === 'tree' ? 'tree' : 'flat') satisfies RoutesFormat
      const maxFiles = integerOrDefault(args.maxFiles, defaultMaxFiles)
      const result = await buildAnyRoutes(root, {
        routePath: args.routePath,
        depth,
        format,
        excludeDirs: defaultExcludeDirs,
        excludeDotEntries: typeof args.excludeDotEntries === 'boolean' ? args.excludeDotEntries : defaultExcludeDotEntries,
        maxFiles,
        respectGitignore: typeof args.respectGitignore === 'boolean' ? args.respectGitignore : defaultRespectGitignore,
      })
      return toJsonValue(result)
    },
  }))
}

/**
 * 本地 JsonValue 别名：上游 `@deepseek-ai/dsh-tools` 自 9135a13a8b 起不再 re-export
 * `JsonValue`（只从 `@deepseek-ai/dsh-util-values` 内部导入）；结构与其保持一致，
 * 避免为单个类型引入新 peer 依赖。
 */
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

function toJsonValue(value: unknown): JsonValue {
  return value as JsonValue
}

function renderJson(value: JsonValue): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

function integerOrDefault(value: unknown, fallback: number): number {
  return Number.isInteger(value) ? value as number : fallback
}
