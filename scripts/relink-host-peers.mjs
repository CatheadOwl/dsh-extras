#!/usr/bin/env node
// relink-host-peers.mjs — wire @deepseek-ai peer names to host workspace source dirs.
//
// Fresh-checkout form of the dev-repo anchor tool scripts/relink-dsh-peers.mjs
// (same name -> source-dir mapping logic): instead of repointing pre-existing
// junctions, it seeds the name list from this package's peerDependencies, so a
// clean clone (CI, new contributor) can resolve @deepseek-ai/* types against a
// host checkout without any prior wiring. Rationale: peers are declared "*"
// with autoInstallPeers off, and the registry latest for several @deepseek-ai
// packages is stale — resolution must come from the host workspace, never the
// registry (dependency-discipline: host peers don't ride the registry).
//
// Usage (from the package root):
//   node scripts/relink-host-peers.mjs [--repo <host-checkout>]           # wire junctions
//   node scripts/relink-host-peers.mjs --check-only [--repo <host-checkout>]  # scan only
// Anchor resolution: --repo > $DSH_REPO > ../../deepseek-harness (nested-repo default).
//
// --check-only verifies every @deepseek-ai peer resolves (realpath) to its mapped
// host workspace source dir — catches missing junctions, stale links into removed
// trees (single-anchor discipline), and registry copies that slipped in. With no
// resolvable anchor it exits 0 ("not applicable") so gate runs in standalone
// mirrors without a host checkout don't false-fail; an explicit --repo/DSH_REPO
// that doesn't exist is still a hard error (exit 2).

import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { resolve, join } from 'node:path'

function parseArgs(argv) {
  const options = { repo: undefined, checkOnly: false }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repo') options.repo = argv[++i]
    else if (argv[i] === '--check-only') options.checkOnly = true
    else {
      process.stderr.write(`error: unknown argument '${argv[i]}'\nusage: node scripts/relink-host-peers.mjs [--repo <host-checkout>] [--check-only]\n`)
      process.exit(2)
    }
  }
  return options
}

// Returns the absolute host anchor, or null when check-only mode has no
// candidate at all (not applicable). Explicit candidates that don't exist
// are always hard errors.
function resolveAnchor(repoFlag, checkOnly) {
  const explicit = []
  for (const candidate of [repoFlag, process.env.DSH_REPO]) {
    if (candidate === undefined || candidate === '') continue
    const absolute = resolve(candidate)
    if (existsSync(absolute)) return absolute
    explicit.push(candidate)
  }
  if (explicit.length > 0) {
    for (const candidate of explicit) {
      process.stderr.write(`error: anchor '${candidate}' does not exist.\n`)
    }
    process.exit(2)
  }
  const nestedDefault = resolve('../../deepseek-harness')
  if (existsSync(nestedDefault)) return nestedDefault
  if (checkOnly) return null
  process.stderr.write('error: host checkout location unknown (pass --repo, set DSH_REPO, or run from a nested repo).\n')
  process.exit(2)
}

// Same enumeration as relink-dsh-peers: walk the host workspace manifest
// patterns and index @deepseek-ai package names to their source dirs.
function mapWorkspacePackages(anchor) {
  const separator = anchor.includes('\\') ? '\\' : '/'
  const segments = anchor.split(/[\\/]/)
  const head = `${segments[0]}${separator}`
  const expandPattern = (pattern) => {
    const walk = (index, base, out) => {
      if (index === pattern.length) { out.push(base); return out }
      const segment = pattern[index]
      if (segment === '*') {
        let entries
        try { entries = readdirSync(base, { withFileTypes: true }) } catch { return out }
        for (const entry of entries) {
          if (entry.isDirectory()) walk(index + 1, join(base, entry.name), out)
        }
        return out
      }
      return walk(index + 1, join(base, segment), out)
    }
    return walk(1, head, [])
  }
  const map = new Map()
  const patterns = [
    [...segments, 'packages', '*', '*', 'package.json'],
    [...segments, 'vendor', '*', 'package.json'],
    [...segments, 'apps', '*', 'package.json'],
    [...segments, 'native', 'landlock-run', 'package.json'],
    [...segments, 'native', 'landlock-run', 'packages', '*', 'package.json'],
  ]
  for (const pattern of patterns) {
    for (const file of expandPattern(pattern)) {
      try {
        const manifest = JSON.parse(readFileSync(file, 'utf8'))
        if (typeof manifest.name === 'string' && manifest.name.startsWith('@deepseek-ai/') && !map.has(manifest.name)) {
          map.set(manifest.name, resolve(file, '..'))
        }
      } catch { /* unreadable manifest: not a workspace package */ }
    }
  }
  return map
}

const options = parseArgs(process.argv.slice(2))
const anchor = resolveAnchor(options.repo, options.checkOnly)
if (anchor === null) {
  process.stdout.write('no host anchor (no --repo, no DSH_REPO, no nested default) — check not applicable, exiting 0.\n')
  process.exit(0)
}
const map = mapWorkspacePackages(anchor)
process.stdout.write(`host anchor: ${anchor}\nworkspace @deepseek-ai packages mapped: ${map.size}\n`)
if (map.size === 0) {
  process.stderr.write('error: host anchor has no @deepseek-ai workspace packages — wrong checkout?\n')
  process.exit(2)
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const peers = Object.keys(manifest.peerDependencies ?? {}).filter((name) => name.startsWith('@deepseek-ai/'))
if (peers.length === 0) {
  process.stderr.write('error: no @deepseek-ai peerDependencies in package.json — nothing to wire.\n')
  process.exit(2)
}

const dir = join('node_modules', '@deepseek-ai')

if (options.checkOnly) {
  const problems = []
  for (const name of peers) {
    const expected = map.get(name)
    if (expected === undefined) {
      problems.push(`${name}: not present in the host workspace (stale peer or renamed host package?)`)
      continue
    }
    const item = join(dir, name.slice('@deepseek-ai/'.length))
    let actual
    try {
      actual = realpathSync(item)
    } catch {
      problems.push(`${name}: no node_modules entry (junction missing or cleared by a bare install)`)
      continue
    }
    if (resolve(actual) !== resolve(expected)) {
      problems.push(`${name}: resolves to ${actual}, expected ${expected} (single-anchor violation or registry copy)`)
    }
  }
  if (problems.length > 0) {
    for (const line of problems) process.stderr.write(`  ${line}\n`)
    process.stderr.write(`relink check: ${problems.length}/${peers.length} peers unhealthy. repair: node scripts/relink-host-peers.mjs\n`)
    process.exit(1)
  }
  process.stdout.write(`relink check: ${peers.length}/${peers.length} peers resolve to the host anchor.\n`)
  process.exit(0)
}

mkdirSync(dir, { recursive: true })
const missing = []
for (const name of peers) {
  const target = map.get(name)
  if (target === undefined) { missing.push(name); continue }
  const item = join(dir, name.slice('@deepseek-ai/'.length))
  try {
    // Idempotent repair: keep entries already resolving to the mapped source,
    // replace anything else (registry copy / stale tree) so a partially wired
    // node_modules converges instead of aborting on the first EEXIST.
    if (resolve(realpathSync(item)) === resolve(target)) continue
    rmSync(item, { recursive: true, force: true })
  } catch { /* no entry yet */ }
  try { symlinkSync(target, item, 'junction') } catch (error) {
    if (error.code !== 'EEXIST' && error.code !== 'EPERM') throw error
    process.stderr.write(`error: cannot wire ${name} -> ${target} (${error.code}); remove the existing entry first.\n`)
    process.exit(1)
  }
}
process.stdout.write(`wired=${peers.length - missing.length} peers=${peers.length}\n`)
if (missing.length > 0) {
  for (const name of missing) process.stderr.write(`  not in host workspace: ${name}\n`)
  process.exit(1)
}
process.stdout.write('done.\n')
