#!/usr/bin/env node
// run-composition.mjs — run host-wired composition suites, or skip loudly when unwired.
//
// Composition suites boot the real host agent loop through this package's peer
// junctions (node_modules/@deepseek-ai/* -> host workspace source dirs) and need
// the host checkout BUILT for the dsh-* exports to resolve. That wiring exists
// only on dev machines with a host checkout; clean clones and the standalone
// mirror cannot run them (wiring runbook: docs/development.md, peer junction
// 接线). This runner keeps the suites inside the routine module test face
// without breaking the clean-clone guarantee, with the same two-way split as
// relink-host-peers --check-only ("no anchor -> not applicable" vs "explicit
// broken anchor -> hard error"):
//
//   probe resolves + export target on disk -> run the suites in a child process
//   no wiring in this checkout            -> loud skip line + exit 0
//   wiring present but not runnable       -> hard error (stale junction into a
//                                            removed tree, or host not built)
//
// The probe package is @deepseek-ai/dsh-agent-loop: it needs BOTH the junction
// and the host build (its exports point into the built lib), so one check
// covers the stricter precondition. Resolution anchors at this script's
// location (package root), the same node_modules tree the suites' own imports
// resolve through.
//
// Usage (cwd = the module dir, files relative to it — mirrors the module test
// scripts' `cd modules/<m> && ...` shape):
//   node ../../scripts/run-composition.mjs test/composition.test.mjs ...

import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROBE_PACKAGE = '@deepseek-ai/dsh-agent-loop'

const files = process.argv.slice(2)
if (files.length === 0) {
  process.stderr.write('usage: node scripts/run-composition.mjs <test-file>...\n')
  process.exit(2)
}
for (const file of files) {
  if (!existsSync(resolve(process.cwd(), file))) {
    process.stderr.write(`error: test file not found (run from the module dir): '${file}'\n`)
    process.exit(2)
  }
}

// The probe package's own directory under this package's node_modules —
// present both for a junction and for a plain directory, but absent on a
// clean clone. lstat (not stat/existsSync) so a junction whose target tree is
// gone still counts as "present" instead of silently degrading to unwired.
function wiringDirPresent() {
  try {
    lstatSync(fileURLToPath(new URL(`../node_modules/${PROBE_PACKAGE}/`, import.meta.url)))
    return true
  } catch {
    return false
  }
}

function probeHost() {
  let resolved
  try {
    resolved = import.meta.resolve(PROBE_PACKAGE)
  } catch {
    return wiringDirPresent() ? 'broken' : 'unwired'
  }
  return existsSync(fileURLToPath(resolved)) ? 'ok' : 'broken'
}

const probe = probeHost()
if (probe === 'unwired') {
  console.log(`[composition] SKIPPED — no ${PROBE_PACKAGE} wiring in this checkout (clean-clone shape).`)
  console.log('[composition] to run the suites: wire peer junctions + build the host checkout — docs/development.md (peer junction 接线).')
  process.exit(0)
}
if (probe === 'broken') {
  process.stderr.write(`error: ${PROBE_PACKAGE} wiring is present but not runnable (stale junction, or host checkout not built).\n`)
  process.stderr.write('fix: re-run scripts/relink-host-peers.mjs and/or build the host checkout — docs/development.md (peer junction 接线).\n')
  process.exit(1)
}

const child = spawnSync(process.execPath, ['--test', '--test-isolation=none', ...files], {
  cwd: process.cwd(),
  stdio: 'inherit',
})
if (child.error) {
  process.stderr.write(`error: failed to spawn test runner: ${child.error.message}\n`)
  process.exit(1)
}
process.exit(child.status ?? 1)
