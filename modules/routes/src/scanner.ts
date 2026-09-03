import type { Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { extractDescription } from './description.js'
import { isGitignored, readGitignoreRules, readInheritedGitignoreRules, type GitignoreRule } from './gitignore.js'
import { isReadmePath, routePath, stripMarkdownExtension } from './path.js'
import type { PathHintCandidate } from './pathHints.js'
import type { MarkdownRouteEntry, RouteDiagnostic } from './types.js'

interface ScanOptions {
  excludeDirs: readonly string[]
  /** Markdown file names (case-insensitive) excluded from routes, e.g. AGENTS.md. */
  excludeFiles: readonly string[]
  /** Skip entries whose name starts with '.', e.g. .github, .agents, .gitignore. */
  excludeDotEntries: boolean
  maxFiles: number
  maxDepth: number
  respectGitignore: boolean
}

/**
 * Agent-instruction files the host loads on its own; they carry no routing
 * value (the agent already has them) so they never appear in route views.
 */
export const DEFAULT_EXCLUDE_FILES: readonly string[] = ['AGENTS.md', 'CLAUDE.md']

export function isExcludedFileName(name: string, excludeFiles: readonly string[]): boolean {
  if (excludeFiles.length === 0) return false
  const lower = name.toLowerCase()
  return excludeFiles.some((excluded) => excluded.toLowerCase() === lower)
}

/** A directory cut off by the scan depth limit; preserved as a truncated route entry. */
interface TruncatedDir {
  dir: string
  /** Recursive .md file count under the truncated directory (the unexpanded .md total). */
  markdownCount: number
  /** Absolute path to the README found directly inside the truncated directory, if any. */
  readmePath: string | null
  /** Description taken from that README's document head, if any. */
  description: string | null
}

interface CollectionResult {
  files: string[]
  truncatedDirs: TruncatedDir[]
}

export async function collectMarkdownEntries(
  root: string,
  options: ScanOptions & { scanRoot: string },
  diagnostics: RouteDiagnostic[],
): Promise<MarkdownRouteEntry[]> {
  let scanStat: Awaited<ReturnType<typeof stat>>
  try {
    scanStat = await stat(options.scanRoot)
  } catch {
    diagnostics.push({
      code: 'scan-root-not-found',
      severity: 'warning',
      message: `Scan root ${routePath(root, options.scanRoot) || '.'} does not exist or is unreadable.`,
      path: routePath(root, options.scanRoot) || '.',
    })
    return []
  }

  if (scanStat.isFile()) {
    diagnostics.push({
      code: 'scan-root-is-file',
      severity: 'warning',
      message: `Scan root ${routePath(root, options.scanRoot)} is a file. Route scans start from folders; use the containing folder route instead.`,
      path: routePath(root, options.scanRoot),
    })
    return []
  }

  if (!scanStat.isDirectory()) {
    diagnostics.push({
      code: 'scan-root-unsupported',
      severity: 'warning',
      message: `Scan root ${routePath(root, options.scanRoot) || '.'} is neither a directory nor a Markdown file.`,
      path: routePath(root, options.scanRoot) || '.',
    })
    return []
  }

  const inheritedRules = options.respectGitignore
    ? await readInheritedGitignoreRules(root, options.scanRoot)
    : []
  const collected = await collectMarkdownFiles(root, options.scanRoot, options, diagnostics, 0, inheritedRules, false)
  const entries = await Promise.all(collected.files.map((file) => buildEntry(root, file, diagnostics)))
  const truncatedEntries = collected.truncatedDirs.map((truncated) => buildTruncatedEntry(root, truncated))
  return [...entries, ...truncatedEntries]
}

export async function collectRouteHintCandidates(
  root: string,
  options: ScanOptions,
  diagnostics: RouteDiagnostic[],
): Promise<PathHintCandidate[]> {
  const collected = await collectMarkdownFiles(root, root, options, diagnostics, 0, [], true)
  const files = collected.files
  const candidates = new Map<string, Set<string>>()
  for (const file of files) {
    const markdownPath = routePath(root, file)
    const folderRoute = routePath(root, path.dirname(file)) || '.'
    addHintCandidate(candidates, folderRoute, markdownPath)
    addHintCandidate(candidates, folderRoute, routePathForMarkdown(root, file))

    if (isReadmePath(file)) {
      addHintCandidate(candidates, folderRoute, stripMarkdownExtension(markdownPath))
    }
  }
  return [...candidates.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([candidatePath, aliases]) => ({
      path: candidatePath,
      aliases: [...aliases].filter((alias) => alias !== candidatePath),
    }))
}

async function collectMarkdownFiles(
  root: string,
  dir: string,
  options: ScanOptions,
  diagnostics: RouteDiagnostic[],
  depth: number,
  inheritedGitignoreRules: readonly GitignoreRule[],
  readCurrentGitignore: boolean,
): Promise<CollectionResult> {
  if (options.maxFiles <= 0) return { files: [], truncatedDirs: [] }

  let children: Dirent[]
  try {
    children = await readdir(dir, { withFileTypes: true })
  } catch {
    diagnostics.push({
      code: 'unreadable-directory',
      severity: 'warning',
      message: `Unable to read directory ${routePath(root, dir) || '.'}.`,
      path: routePath(root, dir) || '.',
    })
    return { files: [], truncatedDirs: [] }
  }

  const files: string[] = []
  const truncatedDirs: TruncatedDir[] = []
  const currentGitignoreRules = readCurrentGitignore ? await readGitignoreRules(dir) : []
  const gitignoreRules = options.respectGitignore
    ? [...inheritedGitignoreRules, ...currentGitignoreRules]
    : inheritedGitignoreRules
  children.sort((left: Dirent, right: Dirent) => left.name.localeCompare(right.name))

  for (const child of children) {
    if (files.length >= options.maxFiles) break
    if (options.excludeDotEntries && child.name.startsWith('.')) continue
    const childPath = path.join(dir, child.name)
    const childIsDirectory = child.isDirectory()

    if (options.respectGitignore && isGitignored(childPath, childIsDirectory, gitignoreRules)) continue

    if (childIsDirectory) {
      if (options.excludeDirs.includes(child.name)) continue
      if (depth >= options.maxDepth) {
        // Depth boundary: this folder is truncated (its children are not read), but
        // the folder is still represented by the README one level down — read that
        // README so the route line keeps its description. The omitted count is the
        // recursive .md total (what would expand), keeping `[truncated: N]` stable
        // regardless of which scan root observes this folder.
        const truncated = await describeTruncatedDir(childPath, options)
        if (truncated.markdownCount > 0) {
          truncatedDirs.push(truncated)
        }
        continue
      }
      const nested = await collectMarkdownFiles(root, childPath, {
        ...options,
        maxFiles: options.maxFiles - files.length,
      }, diagnostics, depth + 1, gitignoreRules, true)
      files.push(...nested.files)
      truncatedDirs.push(...nested.truncatedDirs)
      continue
    }

    if (child.isFile() && child.name.toLowerCase().endsWith('.md')) {
      if (isExcludedFileName(child.name, options.excludeFiles)) continue
      files.push(childPath)
    }
  }

  return { files, truncatedDirs }
}

/** Shallow README read at a depth-boundary directory, plus a recursive .md count for the omitted total. */
async function describeTruncatedDir(dir: string, options: ScanOptions): Promise<TruncatedDir> {
  let mdCount = 0
  let readmePath: string | null = null
  let description: string | null = null

  const walk = async (currentDir: string, isRoot: boolean): Promise<void> => {
    let children: Dirent[]
    try {
      children = await readdir(currentDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const child of children) {
      if (options.excludeDotEntries && child.name.startsWith('.')) continue
      const childPath = path.join(currentDir, child.name)
      if (child.isDirectory()) {
        if (options.excludeDirs.includes(child.name)) continue
        await walk(childPath, false)
      } else if (child.isFile() && child.name.toLowerCase().endsWith('.md')) {
        if (isExcludedFileName(child.name, options.excludeFiles)) continue
        mdCount++
        if (isRoot && readmePath === null && child.name.toLowerCase() === 'readme.md') {
          readmePath = childPath
          try {
            description = extractDescription(await readFile(childPath, 'utf8'))
          } catch {
            description = null
          }
        }
      }
    }
  }

  await walk(dir, true)
  return { dir, markdownCount: mdCount, readmePath, description }
}

function addHintCandidate(candidates: Map<string, Set<string>>, candidatePath: string, alias: string): void {
  const aliases = candidates.get(candidatePath) ?? new Set<string>()
  aliases.add(alias)
  candidates.set(candidatePath, aliases)
}

async function buildEntry(
  root: string,
  markdownFile: string,
  diagnostics: RouteDiagnostic[],
): Promise<MarkdownRouteEntry> {
  const markdownPath = routePath(root, markdownFile)
  const kind = 'file'
  const content = await readMarkdownFile(root, markdownFile, diagnostics)
  const description = extractDescription(content)

  return {
    path: markdownPath,
    markdownPath,
    kind,
    description,
    diagnostics: [],
  }
}

function routePathForMarkdown(root: string, markdownFile: string): string {
  const markdownPath = routePath(root, markdownFile)
  return stripMarkdownExtension(markdownPath)
}

function buildTruncatedEntry(root: string, truncated: TruncatedDir): MarkdownRouteEntry {
  const folderPath = routePath(root, truncated.dir)
  return {
    path: folderPath,
    markdownPath: truncated.readmePath ? routePath(root, truncated.readmePath) : '',
    kind: 'folder',
    description: truncated.description,
    truncated: true,
    omittedMarkdownCount: truncated.markdownCount,
    diagnostics: [],
  }
}

async function readMarkdownFile(
  root: string,
  file: string,
  diagnostics: RouteDiagnostic[],
): Promise<string> {
  try {
    await stat(file)
    return await readFile(file, 'utf8')
  } catch {
    diagnostics.push({
      code: 'unreadable-file',
      severity: 'warning',
      message: `Unable to read Markdown file ${routePath(root, file)}.`,
      path: routePath(root, file),
    })
    return ''
  }
}
