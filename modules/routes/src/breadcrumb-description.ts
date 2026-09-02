import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { extractDescription } from './description.js'
import { isGitignored, readInheritedGitignoreRules, type GitignoreRule } from './gitignore.js'
import { isPathUnderLexical, routePath } from './path.js'

export interface BreadcrumbDescriptionOptions {
  root: string
  excludeDirs: readonly string[]
  excludeDotEntries: boolean
  respectGitignore: boolean
}

/**
 * Local structural mirror of prompt-middleware's frozen `RelatesResolveResult`.
 * The provider is registered through the `ctx.inject(['promptMiddleware'], ...)`
 * soft dependency, so any_routes keeps no hard type/runtime import of
 * prompt-middleware (same registration shape as coggit's cognition-link).
 */
export interface BreadcrumbRelatesResult {
  value?: string
  href?: string
  meta?: Record<string, string>
}

/** Structural subset of the frozen `DeclarativeRelatesProvider` this provider implements. */
export interface BreadcrumbRelatesProvider {
  name: string
  kind: string
  priority: number
  timeoutMs: number
  subjectOf(subject: { path: string; kind: 'file' | 'directory' }): string
  resolve(ctx: BreadcrumbResolveContext): Promise<BreadcrumbRelatesResult | undefined>
}

/** One resolved path plus the turn input the declarative resolver needs. */
export interface BreadcrumbResolveContext {
  path: { path: string; kind: 'file' | 'directory' }
  input: { cwd: string; signal: AbortSignal; turnId: string }
}

/** Memoized README description reads, shared across paths within one turn. */
export interface DescriptionCache {
  get(markdownPath: string): Promise<string | null>
}

interface BreadcrumbCrumb {
  markdownPath: string
  description: string
}

const PROVIDER_NAME = 'breadcrumb-description-enricher'
const PROVIDER_KIND = 'breadcrumb-description'
// annotation band (100–199), after cognition-link's canonical band (0–99).
const PROVIDER_PRIORITY = 100
const PROVIDER_TIMEOUT_MS = 1_000
const README_FILE = 'README.md'

/**
 * Declarative provider: one turn-scoped description cache (keyed on
 * `input.turnId`) reused across paths, rebuilt when the turn changes — the same
 * closure-state pattern as cognition-link's snapshot, but a lazy memoization
 * cache instead of an eagerly-built snapshot.
 */
export function createBreadcrumbDescriptionProvider(options: BreadcrumbDescriptionOptions): BreadcrumbRelatesProvider {
  let cachedTurnId: string | undefined
  let descriptions: DescriptionCache | undefined
  return {
    name: PROVIDER_NAME,
    kind: PROVIDER_KIND,
    priority: PROVIDER_PRIORITY,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    subjectOf: breadcrumbSubject,
    resolve: async (ctx) => {
      if (cachedTurnId !== ctx.input.turnId) {
        descriptions = createDescriptionCache()
        cachedTurnId = ctx.input.turnId
      }
      return resolveBreadcrumbPath(ctx, options, descriptions)
    },
  }
}

/**
 * Pure subject projection: a file's breadcrumb is keyed by its directory — the
 * file itself is something the agent reads, the chain orients WHERE it sits —
 * and a directory's by itself, so a file mention and its folder mention render
 * the same group. A workspace-root file has no dirname to offer and falls back
 * to itself; its ancestor chain is empty anyway, so no item materializes.
 */
export function breadcrumbSubject(subject: { path: string; kind: 'file' | 'directory' }): string {
  if (subject.kind === 'directory') return subject.path
  const directory = subject.path.split('/').slice(0, -1).join('/')
  return directory === '' ? subject.path : directory
}

export function registerBreadcrumbDescriptionProvider(
  ctx: import('@deepseek-ai/cordis').Context,
  options: BreadcrumbDescriptionOptions,
): void {
  void ctx.inject(['promptMiddleware'], (promptCtx) => {
    return (promptCtx as unknown as {
      promptMiddleware: {
        registerRelates(provider: BreadcrumbRelatesProvider): unknown
      }
    }).promptMiddleware.registerRelates(createBreadcrumbDescriptionProvider(options))
  })
}

/**
 * Pure per-path resolver: returns `{ value, meta }` for one breadcrumb
 * contribution, or `undefined` when the path is filtered out (outside the scan
 * root, an excluded segment, gitignored, non-existent, or no crumbs). The
 * framework materializes the `kind`/`label` shell, the `once` ledger, and —
 * through the declared `subjectOf` — the directory key the chain renders
 * under. Only ancestor README descriptions are collected: the mentioned file
 * itself is read, not described, so files never contribute their own crumb.
 */
export async function resolveBreadcrumbPath(
  ctx: BreadcrumbResolveContext,
  options: BreadcrumbDescriptionOptions,
  descriptions: DescriptionCache = createDescriptionCache(),
): Promise<BreadcrumbRelatesResult | undefined> {
  const workspaceRoot = path.resolve(ctx.input.cwd)
  const scanRoot = path.resolve(workspaceRoot, options.root)
  if (!isPathUnderLexical(scanRoot, workspaceRoot)) return undefined
  if (ctx.input.signal.aborted) return undefined

  const normalizedPath = normalizePromptPath(ctx.path.path)
  const absoluteTarget = path.resolve(workspaceRoot, normalizedPath)
  if (!isPathUnderLexical(absoluteTarget, workspaceRoot)) return undefined
  if (!isPathUnderLexical(absoluteTarget, scanRoot)) return undefined
  if (hasExcludedSegment(routePath(workspaceRoot, absoluteTarget), options)) return undefined

  const targetKind = await existingKind(absoluteTarget)
  if (targetKind === null) return undefined

  const targetDir = targetKind === 'directory' ? absoluteTarget : path.dirname(absoluteTarget)
  const gitignoreRules = options.respectGitignore
    ? await readInheritedGitignoreRules(workspaceRoot, targetDir)
    : []
  if (options.respectGitignore && isGitignored(absoluteTarget, targetKind === 'directory', gitignoreRules)) return undefined

  const crumbs = await collectBreadcrumbCrumbs({
    workspaceRoot,
    scanRoot,
    absoluteTarget,
    targetKind,
    gitignoreRules,
    descriptions,
    options,
  })
  if (crumbs.length === 0) return undefined

  return {
    value: renderBreadcrumbCrumbs(crumbs),
    meta: {
      source: 'any_routes',
      markdownPaths: crumbs.map((crumb) => crumb.markdownPath).join(', '),
    },
  }
}

async function collectBreadcrumbCrumbs(input: {
  workspaceRoot: string
  scanRoot: string
  absoluteTarget: string
  targetKind: 'file' | 'directory'
  gitignoreRules: readonly GitignoreRule[]
  descriptions: DescriptionCache
  options: BreadcrumbDescriptionOptions
}): Promise<BreadcrumbCrumb[]> {
  const targetDir = input.targetKind === 'directory'
    ? input.absoluteTarget
    : path.dirname(input.absoluteTarget)
  const directories = ancestorDirectories(input.scanRoot, targetDir)
  const crumbs: BreadcrumbCrumb[] = []

  for (const directory of directories) {
    // scan root 自身的 README 不进入面包屑链：它描述的是 workspace/项目本身
    // （常见脚手架残留），对 file/folder 目标一律不收集，与目标类型无关。
    if (path.resolve(directory) === path.resolve(input.scanRoot)) continue
    const readmePath = path.join(directory, README_FILE)
    if (input.options.respectGitignore && isGitignored(readmePath, false, input.gitignoreRules)) continue
    const description = await input.descriptions.get(readmePath)
    if (!description) continue
    crumbs.push({
      markdownPath: routePath(input.workspaceRoot, readmePath),
      description,
    })
  }

  // 文件目标不收集文件自身描述（frontmatter 或首行正文）：被提到的文件本身
  // 就是要读的对象，其自述在读文件时自然可见；这里只补「它长在哪」的祖先链。
  // 目录目标仍含其自身 README——对目录而言那是祖先链的末端，不是「要读的目标」。

  return crumbs
}

function createDescriptionCache(): DescriptionCache {
  const cache = new Map<string, Promise<string | null>>()
  return {
    get(markdownPath) {
      const key = path.resolve(markdownPath)
      let value = cache.get(key)
      if (!value) {
        value = readMarkdownDescription(key)
        cache.set(key, value)
      }
      return value
    },
  }
}

async function readMarkdownDescription(markdownPath: string): Promise<string | null> {
  try {
    const file = await stat(markdownPath)
    if (!file.isFile()) return null
    return extractDescription(await readFile(markdownPath, 'utf8'))
  } catch {
    return null
  }
}

async function existingKind(
  absoluteTarget: string,
): Promise<'file' | 'directory' | null> {
  try {
    const value = await stat(absoluteTarget)
    if (value.isDirectory()) return 'directory'
    if (value.isFile()) return 'file'
    return null
  } catch {
    return null
  }
}

function ancestorDirectories(scanRoot: string, targetDir: string): string[] {
  const root = path.resolve(scanRoot)
  const target = path.resolve(targetDir)
  if (!isPathUnderLexical(target, root)) return []

  const relative = path.relative(root, target)
  const segments = relative === '' ? [] : relative.split(path.sep).filter(Boolean)
  const directories = [root]
  for (let index = 0; index < segments.length; index += 1) {
    directories.push(path.join(root, ...segments.slice(0, index + 1)))
  }
  return directories
}

function renderBreadcrumbCrumbs(crumbs: readonly BreadcrumbCrumb[]): string {
  return crumbs
    .map((crumb) => crumb.description)
    .join(' > ')
}

function normalizePromptPath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/u, '').replace(/\/+$/u, '')
  return normalized || '.'
}

function hasExcludedSegment(route: string, options: BreadcrumbDescriptionOptions): boolean {
  return route.split('/').some((segment) => {
    if (segment === '' || segment === '.') return false
    if (options.excludeDotEntries && segment.startsWith('.')) return true
    return options.excludeDirs.includes(segment)
  })
}
