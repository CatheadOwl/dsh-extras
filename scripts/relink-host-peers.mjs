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
//   node scripts/relink-host-peers.mjs --repo <host-checkout>
// Anchor resolution: --repo > $DSH_REPO > ../../deepseek-harness (nested-repo default).

import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync } from 'node:fs'
import { resolve, join } from 'node:path'

function parseArgs(argv) {
  const options = { repo: undefined }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repo') options.repo = argv[++i]
    else {
      process.stderr.write(`error: unknown argument '${argv[i]}'\nusage: node scripts/relink-host-peers.mjs --repo <host-checkout>\n`)
      process.exit(2)
    }
  }
  return options
}

function resolveAnchor(repoFlag) {
  for (const candidate of [repoFlag, process.env.DSH_REPO, '../../deepseek-harness']) {
    if (candidate === undefined || candidate === '') continue
    const absolute = resolve(candidate)
    if (existsSync(absolute)) return absolute
    if (candidate === repoFlag || candidate === process.env.DSH_REPO) {
      process.stderr.write(`error: anchor '${candidate}' does not exist.\n`)
      process.exit(2)
    }
  }
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
const anchor = resolveAnchor(options.repo)
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
mkdirSync(dir, { recursive: true })
const missing = []
for (const name of peers) {
  const target = map.get(name)
  if (target === undefined) { missing.push(name); continue }
  const item = join(dir, name.slice('@deepseek-ai/'.length))
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
