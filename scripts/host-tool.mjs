#!/usr/bin/env node
// host-tool.mjs — run tsdown from an anchor-resolved host checkout. tsdown is
// the one true host borrow left in the toolchain: the clientBundle preset it
// must pair with lives only in the host source tree (no npm exit — upstream
// issue host-dev-surface-publication), so an own-devDep tsdown could drift
// from the host preset's expectations. tsc, by contrast, runs from this
// package's own devDependency install and never comes through here.
//
// Anchor resolution (mirrors relink-host-peers.mjs): $DSH_REPO (machine env)
// > <package-root>/../../deepseek-harness (nested-repo default). Fail-loud
// with placeholder guidance when neither exists — no machine path examples.
//
// Usage (from modules/client, whose tsdown.config.ts pairs with this entry):
//   node ../../scripts/host-tool.mjs tsdown
//
// Scope: dev-time toolchain borrow only. It does not enter the shipped
// artifact and places no obligation on consumers (the tarball carries lib/
// outputs only).

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const packageRoot = resolve(fileURLToPath(import.meta.url), '..', '..')

const TOOLS = {
  tsdown: (anchor) => resolve(anchor, 'node_modules/tsdown/dist/run.mjs'),
}

function resolveAnchor() {
  const candidates = [
    { label: '$DSH_REPO', value: process.env.DSH_REPO },
    { label: 'nested-repo default', value: '../../deepseek-harness' },
  ]
  for (const candidate of candidates) {
    if (candidate.value === undefined || candidate.value === '') continue
    const absolute = resolve(packageRoot, candidate.value)
    if (existsSync(absolute)) return absolute
    process.stderr.write(`error: host checkout anchor '${candidate.label}' does not exist.\n`)
    process.exit(2)
  }
  process.stderr.write(
    'error: host checkout location unknown. Set DSH_REPO to a built deepseek-harness checkout, '
    + 'or place one at ../../deepseek-harness relative to this package.\n',
  )
  process.exit(2)
}

const toolName = process.argv[2]
const toolEntry = TOOLS[toolName]
if (toolEntry === undefined) {
  process.stderr.write(`error: unknown tool '${toolName}'. Usage: node scripts/host-tool.mjs <tsdown> [args...]\n`)
  process.exit(2)
}

const anchor = resolveAnchor()
const toolPath = toolEntry(anchor)
if (!existsSync(toolPath)) {
  process.stderr.write(`error: tool '${toolName}' not found in the host checkout (expected node_modules there; run pnpm install && pnpm run build in the host checkout first).\n`)
  process.exit(2)
}

const child = spawn(process.execPath, [toolPath, ...process.argv.slice(3)], { stdio: 'inherit' })
child.on('close', (code) => process.exit(code ?? 1))
