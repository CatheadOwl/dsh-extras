import { readFile } from 'node:fs/promises'
import path from 'node:path'

export interface GitignoreRule {
  baseDir: string
  pattern: string
  negated: boolean
  directoryOnly: boolean
}

export async function readInheritedGitignoreRules(root: string, scanRoot: string): Promise<GitignoreRule[]> {
  const rootPath = path.resolve(root)
  const scanRootPath = path.resolve(scanRoot)
  const relativeScanRoot = normalizeSlash(path.relative(rootPath, scanRootPath))
  const segments = relativeScanRoot && !relativeScanRoot.startsWith('..')
    ? relativeScanRoot.split('/').filter(Boolean)
    : []
  const dirs = [rootPath]

  for (let index = 0; index < segments.length; index += 1) {
    dirs.push(path.join(rootPath, ...segments.slice(0, index + 1)))
  }

  const rules = await Promise.all(dirs.map((dir) => readGitignoreRules(dir)))
  return rules.flat()
}

export async function readGitignoreRules(dir: string): Promise<GitignoreRule[]> {
  let content: string
  try {
    content = await readFile(path.join(dir, '.gitignore'), 'utf8')
  } catch {
    return []
  }

  return content
    .split(/\r?\n/u)
    .map((line) => parseGitignoreLine(dir, line))
    .filter((rule): rule is GitignoreRule => rule !== null)
}

export function isGitignored(
  filePath: string,
  isDirectory: boolean,
  rules: readonly GitignoreRule[],
): boolean {
  let ignored = false

  for (const rule of rules) {
    if (rule.directoryOnly && !isDirectory) continue
    if (!matchesRule(filePath, rule)) continue
    ignored = !rule.negated
  }

  return ignored
}

function parseGitignoreLine(baseDir: string, rawLine: string): GitignoreRule | null {
  let line = rawLine.trim()
  if (!line || line.startsWith('#')) return null

  let negated = false
  if (line.startsWith('!')) {
    negated = true
    line = line.slice(1).trim()
  }

  if (!line) return null

  const directoryOnly = line.endsWith('/')
  line = line.replace(/^\/+/u, '').replace(/\/+$/u, '')
  if (!line) return null

  return {
    baseDir,
    pattern: normalizeSlash(line),
    negated,
    directoryOnly,
  }
}

function matchesRule(filePath: string, rule: GitignoreRule): boolean {
  const relativePath = normalizeSlash(path.relative(rule.baseDir, filePath))
  if (!relativePath || relativePath.startsWith('..')) return false

  if (!rule.pattern.includes('/')) {
    return relativePath.split('/').some((part) => matchesGlob(part, rule.pattern))
  }

  return matchesGlob(relativePath, rule.pattern)
}

function matchesGlob(value: string, pattern: string): boolean {
  return new RegExp(`^${globToRegex(pattern)}$`, 'u').test(value)
}

function globToRegex(pattern: string): string {
  let regex = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    const next = pattern[index + 1]

    if (char === '*' && next === '*') {
      regex += '.*'
      index += 1
      continue
    }

    if (char === '*') {
      regex += '[^/]*'
      continue
    }

    if (char === '?') {
      regex += '[^/]'
      continue
    }

    regex += escapeRegex(char)
  }
  return regex
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/gu, '\\$&')
}

function normalizeSlash(value: string): string {
  return value.replace(/\\/gu, '/')
}
