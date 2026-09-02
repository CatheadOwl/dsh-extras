#!/usr/bin/env node
// Package-level face gate for the whole @catheadowl/dsh-extras bundle.
//
// One entry, one config table, every module covered:
//   - the manifest exports face is exactly the entries owned by this table;
//   - each composition row's loader entry (modules/<name>/src/index.ts) may
//     only export the dsh loader contract (name/inject/Config/apply);
//   - public consumer subentries (./register, ./client, ./gate-check) are
//     frozen by facade allowlists;
//   - deep imports bypassing @catheadowl/dsh-extras/register are forbidden
//     across all module sources and docs.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { loadTypeScript } from './lib/resolve-typescript.mjs'
import { verifyPackageFace } from './lib/package-face.mjs'

const OWN_NAME = '@catheadowl/dsh-extras'
const LOADER_CONTRACT = ['name', 'inject', 'Config', 'apply']

// Public consumer entries of the bundle: subpath -> source file (relative to
// the package root). Modules without an exports entry simply have no row here.
const SUBENTRIES = {
  './register': 'modules/gates/src/register.ts',
  './client': 'modules/gates/src/client/index.ts',
  './gate-check': 'modules/md/src/gate-check.ts',
}

function absoluteSubentries(root) {
  return Object.fromEntries(Object.entries(SUBENTRIES).map(([entry, source]) => [entry, join(root, source)]))
}

// Frozen facade for the register entry: the gates API face (w12). Adding a
// public export requires updating this list (and regenerating docs/register.md).
const FACADE_EXPORTS = {
  './register': [
    'registerGate',
    'GateChangeSet',
    'GateDefinition',
    'GateFixer',
    'GateFixerCommand',
    'GateFixerSubagent',
    'GateFixerSubagentRequest',
    'GateLevel',
    'GateRemedy',
    'GateRemedyManual',
    'GateRemedyOperation',
    'GateResult',
    'GateStatus',
    'GateTrigger',
    'GateViolation',
  ],
}

const FORBIDDEN_IMPORTS = [
  /from\s+['"]@catheadowl\/dsh-extras(?!\/register(?:\.js)?['"])[^'"]*['"]/u,
]

// Every composition-row module with a loader entry — each is checked against
// the loader contract; the entry being present is itself required. Nested
// packages (own package.json, e.g. the client anchor) are separate packages,
// not rows of this bundle, and are skipped.
function moduleEntries(root) {
  const modulesDir = join(root, 'modules')
  const modules = existsSync(modulesDir)
    ? readdirSync(modulesDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .filter(entry => !existsSync(join(modulesDir, entry.name, 'package.json')))
        .map(entry => entry.name)
    : []
  return modules
    .map(name => [name, join(root, 'modules', name, 'src', 'index.ts')])
    .filter(([, entryPath]) => existsSync(entryPath))
}

function scanPaths(root, moduleNames) {
  return moduleNames.flatMap(name => [
    join(root, 'modules', name, 'src'),
    join(root, 'modules', name, 'docs'),
  ]).filter(existsSync)
}

export async function check(root) {
  const ts = await loadTypeScript()
  const modules = moduleEntries(root)
  const violations = []
  // One package-level pass: manifest exports face, public subentry facades,
  // forbidden deep imports across all modules.
  violations.push(...await verifyPackageFace({
    package: join(root, 'package.json'),
    rootExport: null, // bundle shape: rows load via relative subpaths
    allowedExports: Object.keys(SUBENTRIES),
    rootEntry: join(root, 'modules/gates/src/index.ts'),
    rootExports: LOADER_CONTRACT,
    subentries: absoluteSubentries(root),
    facadeExports: FACADE_EXPORTS,
    forbiddenImports: FORBIDDEN_IMPORTS,
    scanPaths: scanPaths(root, modules.map(([name]) => name)),
    ts,
  }))
  // Per-module pass: each composition row's loader entry stays on the loader
  // contract (the package-level pass already covered gates itself).
  for (const [name, entryPath] of modules) {
    if (entryPath === join(root, 'modules/gates/src/index.ts')) continue
    violations.push(...await verifyPackageFace({
      package: join(root, 'package.json'),
      rootExport: null,
      allowedExports: Object.keys(SUBENTRIES),
      rootEntry: entryPath,
      rootExports: LOADER_CONTRACT,
      subentries: {},
      ts,
    }).then(reasons => reasons.map(reason => `[${name}] ${reason}`)))
  }
  return violations.map(reason => ({
    reason,
    remedy: {
      kind: 'manual',
      guidance: `Keep every composition row on the dsh loader contract and expose plugin-consumer symbols only through ${OWN_NAME} public entries.`,
    },
  }))
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('verify-package-face.mjs')) {
  const { fileURLToPath } = await import('node:url')
  const { resolve } = await import('node:path')
  const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
  check(root).then((violations) => {
    for (const violation of violations) console.error(violation.reason)
    process.exitCode = violations.length === 0 ? 0 : 1
  }, (error) => {
    console.error(error.message)
    process.exitCode = 2
  })
}
