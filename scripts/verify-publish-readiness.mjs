#!/usr/bin/env node
// Publish-readiness clamp for the gates package.
//
// Rules (independently publishable = host provided at runtime, everything else
// resolvable from a public registry, docs self-contained):
//   1. manifest: no `private: true` (npm publish would refuse).
//   2. dependencies: registry ranges only — no `link:`/`file:`/`workspace:`
//      or path specifiers, and no `@deepseek-ai/*` host packages (those are
//      peerDependencies, provided by the dsh host at runtime).
//   3. devDependencies may use `link:` only for host packages (`@deepseek-ai/*`);
//      public packages must use registry ranges in every dependency field.
//   4. import coverage: every bare specifier imported from src/ must be declared
//      in dependencies or peerDependencies (catches e.g. `react` used by the
//      client half but only present in devDependencies).
//   5. docs locality: markdown links in README.md, docs/ and eval/ must stay
//      inside the package root and must not use absolute repo paths — the
//      published docs cannot reach the surrounding dev repository.
//   6. npm scripts locality: path arguments in `scripts` entries must stay
//      inside the package root; borrowing host checkout paths (L0) is allowed.
//   7. meta locality: module sources must not cite dev-repo control-plane
//      terms (ADR/RFC/PRD/SPEC ids, spec docs, dated workunit TODOs) —
//      comments carry functional semantics, design attribution lives in the
//      cognition layer.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOST_SCOPE = '@deepseek-ai/'
const OWN_NAME = '@catheadowl/dsh-extras'
const NON_REGISTRY_SPECIFIER = /^(link|file|workspace|portal|cat|patch|git\+|https?:\/\/|[A-Za-z]:\\|\/|\.\/|\.\.\/)/u

function manifestRules(manifest) {
  const violations = []
  if (manifest.private === true) violations.push('package.json has "private": true — remove it before publishing')
  for (const field of ['dependencies', 'devDependencies']) {
    for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
      if (typeof specifier !== 'string') continue
      if (field === 'dependencies') {
        if (name.startsWith(HOST_SCOPE)) violations.push(`dependencies must not contain host package ${name} — move it to peerDependencies (runtime is provided by the dsh host)`)
        if (NON_REGISTRY_SPECIFIER.test(specifier)) violations.push(`dependencies.${name} uses non-registry specifier "${specifier}" — publish needs a registry range`)
      }
      else if (NON_REGISTRY_SPECIFIER.test(specifier) && !name.startsWith(HOST_SCOPE)) {
        violations.push(`devDependencies.${name} uses non-registry specifier "${specifier}" — only @deepseek-ai/* host packages may use link:/path specifiers`)
      }
    }
  }
  return violations
}

// Package content roots: one per `modules/<name>/` directory (extras layout),
// plus the bare package root when it carries sources itself (single-package
// layout used by fixtures and forks of this engine).
function contentRoots(root) {
  const modules = join(root, 'modules')
  const roots = existsSync(modules)
    ? readdirSync(modules, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => join(root, 'modules', entry.name))
    : []
  if (existsSync(join(root, 'src')) || existsSync(join(root, 'scripts')) || existsSync(join(root, 'README.md'))) roots.push(root)
  return roots
}

function collectFiles(path, extensions, result = []) {
  if (!existsSync(path)) return result
  const stat = statSync(path)
  if (stat.isFile()) {
    if (extensions.includes(extname(path))) result.push(path)
    return result
  }
  for (const entry of readdirSync(path)) {
    if (entry === 'node_modules' || entry === '.runs' || entry === '.git' || entry === 'lib') continue
    collectFiles(join(path, entry), extensions, result)
  }
  return result
}

function packageName(specifier) {
  const segments = specifier.split('/')
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
}

function importSpecifiers(text) {
  const found = new Set()
  const patterns = [
    /(?:from|import)\s+['"]([^'"]+)['"]/gu,
    /import\(\s*['"]([^'"]+)['"]\s*\)/gu,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.add(match[1])
  }
  return found
}

function importCoverage(root, declared) {
  const violations = []
  for (const contentRoot of contentRoots(root)) for (const file of collectFiles(join(contentRoot, 'src'), ['.ts', '.tsx'])) {
    for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('.') || specifier.startsWith('node:')) continue
      const name = packageName(specifier)
      if (name === OWN_NAME) continue
      // Type-only bare import satisfied by an @types mapping: a type import
      // of bare package `mdast` passes when `@types/mdast` is declared — the
      // same NodeNext resolution the compiler performs.
      if (declared.has(`@types/${name}`)) continue
      if (!declared.has(name)) {
        violations.push(`${relative(root, file).replaceAll('\\', '/')} imports ${name} but it is declared in neither dependencies nor peerDependencies`)
      }
    }
  }
  return violations
}

// Scripts are dev-time code but still part of the shipped repository: their
// imports and new URL(...) path literals must stay inside the package root,
// and bare imports must be node builtins or declared dependencies.
function scriptsLocality(root, declared, extraScripts = []) {
  const violations = []
  const entries = [
    ...contentRoots(root).flatMap(contentRoot => collectFiles(join(contentRoot, 'scripts'), ['.mjs', '.js'])),
    ...extraScripts.map(extra => ({ path: join(root, extra.path), text: extra.text })),
  ]
  for (const entry of entries) {
    const file = typeof entry === 'string' ? entry : entry.path
    const text = typeof entry === 'string' ? readFileSync(file, 'utf8') : entry.text
    const displayed = relative(root, file).replaceAll('\\', '/')
    const relativeRefs = new Set(importSpecifiers(text))
    for (const match of text.matchAll(/new URL\(\s*'([^']+)'/gu)) relativeRefs.add(match[1])
    for (const reference of relativeRefs) {
      if (!reference.startsWith('.')) {
        const name = packageName(reference)
        if (!reference.startsWith('node:') && name !== OWN_NAME && !declared.has(name)) {
          violations.push(`${displayed} imports ${name} but it is declared in neither dependencies nor peerDependencies`)
        }
        continue
      }
      const target = resolve(dirname(file), reference)
      if (!target.startsWith(root + '/') && !target.startsWith(root + '\\')) {
        violations.push(`${displayed} references ${reference} which resolves outside the package root`)
      }
    }
  }
  return violations
}

// npm `scripts` entries ship with the package: path arguments in their command
// lines are under the same locality constraint as scripts/*.mjs — they must not
// reach siblings, the shared eval harness, or other dev-repo directories. The
// documented L0 exception (borrowing host .bin / host checkout paths, see
// resolution-ladder) is allowed. Each `&&`-separated segment is scanned with
// the resolution base moved by any preceding `cd <dir> &&` segment (that is
// where the shell actually runs that segment).
function npmScriptsLocality(manifest, root) {
  const violations = []
  const hostRoot = resolve(root, '../..', 'deepseek-harness')
  const inside = (target, base) => target === base || target.startsWith(base + '/') || target.startsWith(base + '\\')
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    if (typeof command !== 'string') continue
    let base = root
    for (const segment of command.split('&&')) {
      const cd = /^cd\s+([^\s&|;]+)\s*$/u.exec(segment.trim())?.[1]
      if (cd !== undefined) {
        base = /^[A-Za-z]:\\|^\//u.test(cd) ? resolve(cd) : resolve(base, cd)
        continue
      }
      for (const match of segment.matchAll(/(?:\.\.[/\\])+[^\s'"&|;]+/gu)) {
        const token = match[0]
        const target = resolve(base, token)
        if (!inside(target, root) && !inside(target, hostRoot)) {
          violations.push(`scripts.${name} references ${token} which resolves outside the package root (and is not a documented L0 host borrow) — keep dev-repo-only commands out of the shipped manifest`)
        }
      }
    }
  }
  return violations
}

function markdownLinks(markdown) {
  const withoutFences = markdown.replace(/```[\s\S]*?```/gu, '').replace(/`[^`\n]*`/gu, '')
  const links = []
  for (const match of withoutFences.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)) links.push(match[1])
  return links
}

function docsLocality(root, extraMarkdown = []) {
  const violations = []
  const targets = [
    ...contentRoots(root).flatMap(contentRoot => [
      join(contentRoot, 'README.md'),
      ...collectFiles(join(contentRoot, 'docs'), ['.md']),
      ...collectFiles(join(contentRoot, 'eval'), ['.md']),
    ]),
    ...extraMarkdown.map(entry => ({ path: join(root, entry.path), text: entry.text })),
  ]
  for (const file of targets) {
    const text = typeof file === 'string' ? readFileSync(file, 'utf8') : file.text
    const displayed = typeof file === 'string' ? file : file.path
    for (const link of markdownLinks(text)) {
      if (/^[a-z][a-z0-9+.-]*:/iu.test(link) || link.startsWith('#')) continue
      const pathPart = link.split('#', 1)[0]
      if (pathPart === '') continue
      if (pathPart.startsWith('/')) {
        violations.push(`${relative(root, displayed).replaceAll('\\', '/')} links absolute repo path ${link} — published docs cannot reach the dev repository`)
        continue
      }
      const target = resolve(dirname(String(displayed)), pathPart)
      if (!target.startsWith(root + '/') && !target.startsWith(root + '\\')) {
        violations.push(`${relative(root, displayed).replaceAll('\\', '/')} links outside the package root: ${link}`)
      }
    }
  }
  return violations
}

// Dev-repo control-plane vocabulary (decision-record ids, spec citations,
// dated workunit TODOs) must not appear in module source code: comments there
// carry functional semantics only, design attribution lives in the cognition
// layer. Scanned on the code layer (modules/<m>/src) only — docs/README/eval
// may cite dev-repo evidence as plain text, and dev-repo path namespaces
// (workunits/, handbooks/, ...) double as example data in prompt/routes
// sources, so they stay out of scope. Widen the token set by evidence only.
const META_TERMS = [
  /\b(?:ADR|RFC|PRD|SPEC)[ -]?\d+/u,
  /\bspec\s*[§:「]/u,
  /\bspec's\b/u,
  /\bworkunit spec\b/u,
  /TODO \d{8}/u,
]

// Comment-shaped lines only: `spec` doubles as an ordinary noun / identifier
// (`AtRunSpec`, `spec.dshBin`, "spawn spec"), so the citation forms above are
// matched inside `*`/`//` comment lines, never on code lines.
const COMMENT_LINE = /^\s*(?:\*|\/\/|#)/u

function commentText(text) {
  return text.split(/\r?\n/u).filter(line => COMMENT_LINE.test(line)).join('\n')
}

function metaLocality(root, extraSources = []) {
  const violations = []
  const entries = [
    ...contentRoots(root).flatMap(contentRoot => collectFiles(join(contentRoot, 'src'), ['.ts', '.tsx', '.js', '.mjs'])),
    ...extraSources.map(extra => ({ path: join(root, extra.path), text: extra.text })),
  ]
  for (const entry of entries) {
    const file = typeof entry === 'string' ? entry : entry.path
    const text = typeof entry === 'string' ? readFileSync(file, 'utf8') : entry.text
    const haystack = commentText(text)
    for (const pattern of META_TERMS) {
      pattern.lastIndex = 0
      if (pattern.test(haystack)) {
        violations.push(`${relative(root, file).replaceAll('\\', '/')} cites control-plane term ${pattern} — keep design attribution in the cognition layer, functional semantics in code`)
      }
    }
  }
  return violations
}

export function check(root, options = {}) {
  root = resolve(root)
  const manifest = options.manifestOverride ?? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ])
  const reasons = [
    ...manifestRules(manifest),
    ...npmScriptsLocality(manifest, root),
    ...importCoverage(root, declared),
    ...scriptsLocality(root, declared, options.extraScripts),
    ...docsLocality(root, options.extraMarkdown),
    ...metaLocality(root, options.extraSources),
  ]
  return reasons.map(reason => ({
    reason,
    remedy: {
      kind: 'manual',
      guidance: 'Keep the package independently publishable: host packages as peerDependencies, registry ranges elsewhere, docs self-contained (cite out-of-repo evidence as plain text, not links).',
    },
  }))
}

export function main() {
  const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..') // extras package root
  const violations = check(root)
  for (const violation of violations) console.error(violation.reason)
  return violations.length === 0 ? 0 : 1
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('verify-publish-readiness.mjs')) {
  process.exitCode = main()
}
