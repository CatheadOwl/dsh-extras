#!/usr/bin/env node
// Package-level face gate for a multi-row bundle package (parameterized;
// config in scripts/verify.config.mjs `packageFace` — byte-copy propagated
// from the gate blueprint, never edited in place at the consumer).
//
// One entry, one config table, every module covered:
//   - the manifest exports face is exactly the entries owned by this table;
//   - each composition row's loader entry (modules/<name>/src/index.ts) may
//     only export the dsh loader contract (config `loaderContract`);
//   - public consumer subentries (e.g. ./gates/register) are frozen by
//     facade allowlists (config `facadeExports`);
//   - deep imports bypassing the public register entries are forbidden
//     across all module sources and docs (config `forbiddenImports`).
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

import { loadTypeScript } from './lib/resolve-typescript.mjs'
import { verifyPackageFace } from './lib/package-face.mjs'

export async function loadFaceConfig() {
  const module = await import(pathToFileURL(resolve(fileURLToPath(new URL('./verify.config.mjs', import.meta.url)))).href)
  return module.default.packageFace
}

function absoluteSubentries(root, subentries) {
  return Object.fromEntries(Object.entries(subentries).map(([entry, source]) => [entry, join(root, source)]))
}

// Every composition-row module with a loader entry — each is checked against
// the loader contract; the entry being present is itself required. Nested
// packages (own package.json, e.g. a client anchor) are separate packages,
// not rows of this bundle, and are skipped.
function moduleEntries(root, cfg) {
  const modulesDir = join(root, cfg.modulesDir ?? 'modules')
  const modules = existsSync(modulesDir)
    ? readdirSync(modulesDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .filter(entry => !existsSync(join(modulesDir, entry.name, 'package.json')))
        .map(entry => entry.name)
    : []
  return modules
    .map(name => [name, join(root, cfg.modulesDir ?? 'modules', name, 'src', 'index.ts')])
    .filter(([, entryPath]) => existsSync(entryPath))
}

function scanPaths(root, cfg, moduleNames) {
  return moduleNames.flatMap(name => [
    join(root, cfg.modulesDir ?? 'modules', name, 'src'),
    join(root, cfg.modulesDir ?? 'modules', name, 'docs'),
  ]).filter(existsSync)
}

export async function check(root, cfg = undefined) {
  if (cfg === undefined) cfg = await loadFaceConfig()
  const ts = await loadTypeScript()
  const modules = moduleEntries(root, cfg)
  const skip = new Set(cfg.skipModules ?? [])
  const violations = []
  // One package-level pass: manifest exports face, public subentry facades,
  // forbidden deep imports across all modules.
  violations.push(...await verifyPackageFace({
    package: join(root, 'package.json'),
    rootExport: null, // bundle shape: rows load via relative subpaths
    allowedExports: Object.keys(cfg.subentries),
    rootEntry: join(root, cfg.rootEntry),
    rootExports: cfg.loaderContract,
    subentries: absoluteSubentries(root, cfg.subentries),
    facadeExports: cfg.facadeExports,
    forbiddenImports: cfg.forbiddenImports,
    scanPaths: scanPaths(root, cfg, modules.map(([name]) => name)),
    ts,
  }))
  // Per-module pass: each composition row's loader entry stays on the loader
  // contract (the package-level pass already covered the skipped root row).
  for (const [name, entryPath] of modules) {
    if (skip.has(name) || entryPath === join(root, cfg.rootEntry)) continue
    violations.push(...await verifyPackageFace({
      package: join(root, 'package.json'),
      rootExport: null,
      allowedExports: Object.keys(cfg.subentries),
      rootEntry: entryPath,
      rootExports: cfg.loaderContract,
      subentries: {},
      ts,
    }).then(reasons => reasons.map(reason => `[${name}] ${reason}`)))
  }
  return violations.map(reason => ({
    reason,
    remedy: {
      kind: 'manual',
      guidance: `Keep every composition row on the dsh loader contract and expose plugin-consumer symbols only through ${cfg.ownName} public entries.`,
    },
  }))
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('verify-package-face.mjs')) {
  const { fileURLToPath } = await import('node:url')
  const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
  check(root).then((violations) => {
    for (const violation of violations) console.error(violation.reason)
    process.exitCode = violations.length === 0 ? 0 : 1
  }, (error) => {
    console.error(error.message)
    process.exitCode = 2
  })
}
