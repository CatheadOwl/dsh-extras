/**
 * A/B driver for the relates model-behavior experiment
 * (workunits/prompt-middleware/probe/20260905-relates-behavior-ab.md).
 *
 * Runs the locate cases under both arms (treatment: breadcrumb injection on;
 * control: provider disabled via rowConfig) N times each, extracts trace
 * metrics, enforces per-arm injection guards, and writes results plus a
 * summary to `.runs/relates-ab-<timestamp>/`.
 *
 * Usage (from the extras package root):
 *   node modules/prompt/eval/behavior/real/run-relates-ab.mjs [--n 10] [--cases mention] [--profile headless] [--dry]
 *
 * Requires a real-model credential and a spawn-capable host terminal (the
 * sandboxed in-session shell refuses the child dsh CLI spawns).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { runEvalCase } from '@catheadowl/dsh-eval'
import { resolveDshCliChain } from '@catheadowl/dsh-eval/experimental'

import { ARMS, extractMetrics } from './_ab/arms.mjs'
import { AVOID_PATHS, MARKER, TARGET_PATH } from './_fixtures/seed-doc-tree.mjs'
import orientationCase, { expectsInjection as orientationExpectsInjection } from './orientation-send-window.eval.mjs'
import triageCase, { expectsInjection as triageExpectsInjection } from './triage-deprecated-twin.eval.mjs'

const CASE_MODULES = [
  { key: 'orientation', caseDefinition: orientationCase, expectsInjection: orientationExpectsInjection },
  { key: 'triage', caseDefinition: triageCase, expectsInjection: triageExpectsInjection },
]

const args = parseArgs(process.argv.slice(2))
const runsPerArm = args.n ?? 10

const realHome = (process.env.DSH_HOME ?? '').trim() !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
if (!existsSync(join(realHome, '.credentials.yaml'))) {
  console.error('relates-ab: no credential found (real mode) — run from a host terminal with credentials configured')
  process.exit(1)
}

const cliPath = resolveCli()

/** The locate spec both cases share. */
const SPEC = { targetPath: TARGET_PATH, marker: MARKER, avoidPaths: AVOID_PATHS }

const selected = CASE_MODULES.filter(entry => args.cases === undefined || entry.key.includes(args.cases))
const plan = []
for (const entry of selected) {
  for (const arm of ARMS) {
    for (let index = 1; index <= runsPerArm; index += 1) {
      plan.push({ caseKey: entry.key, caseDefinition: entry.caseDefinition, expectsInjection: entry.expectsInjection, armId: arm.id, index, arm })
    }
  }
}

if (args.dry) {
  console.log(`relates-ab dry run: ${plan.length} runs`)
  for (const entry of selected) {
    console.log(`- case ${entry.key} (${entry.caseDefinition.id})`)
  }
  for (const arm of ARMS) {
    console.log(`- arm ${arm.id}: rowConfig=${JSON.stringify(arm.rowConfig)}`)
  }
  process.exit(0)
}

console.log(`relates-ab: ${plan.length} runs (${selected.length} cases × ${ARMS.length} arms × ${runsPerArm})`)
const rows = []
for (const item of plan) {
  const caseClone = {
    ...item.caseDefinition,
    id: `${item.caseDefinition.id}:${item.armId}:${item.index}`,
    rowConfig: item.arm.rowConfig,
  }
  process.stdout.write(`run ${rows.length + 1}/${plan.length} ${item.caseKey}/${item.armId}#${item.index} … `)
  let result
  try {
    result = await runEvalCase(caseClone, { profile: args.profile ?? 'headless', cliPath, mode: 'real' })
  } catch (error) {
    console.log(`driver error: ${error instanceof Error ? error.message : String(error)}`)
    rows.push({ caseKey: item.caseKey, armId: item.armId, index: item.index, driverError: String(error) })
    continue
  }
  const metrics = result.trace === undefined ? undefined : extractMetrics(result.trace, SPEC)
  let guardOk = undefined
  if (metrics !== undefined) {
    // Arm guards: in the treatment arm the injection state must match the
    // case's expectation (mention variant: injected; topic variant: blocked
    // by the zero-path gate until the suggestion family lands); in the
    // control arm the provider is disabled, so no injection may appear —
    // a leak would fake a treatment effect, a silent failure a null result.
    const expected = item.arm.id === 'treatment' ? item.expectsInjection === true : false
    guardOk = metrics.injectionSeen === expected
    metrics.guardOk = guardOk
  }
  const row = {
    caseKey: item.caseKey,
    armId: item.armId,
    index: item.index,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    inspectError: result.inspectError ?? null,
    metrics: metrics ?? null,
  }
  rows.push(row)
  console.log(formatRunLine(row))
}

const summary = summarize(rows)
const report = { startedAt: new Date().toISOString(), runsPerArm, rows, summary }
const outDir = join(import.meta.dirname, '.runs', `relates-ab-${stamp()}`)
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'results.json'), `${JSON.stringify(report, undefined, 2)}\n`, 'utf8')
writeFileSync(join(outDir, 'summary.md'), renderSummary(summary), 'utf8')
console.log(`\nresults: ${join(outDir, 'results.json')}\n${renderSummary(summary)}`)

/** Resolve the compiled dsh CLI through the framework's resolution chain
 * (DSH_REPO env as the explicit repo flag, else the node_modules layer). */
function resolveCli() {
  const repo = (process.env.DSH_REPO ?? '').trim()
  try {
    const { cli } = resolveDshCliChain({ repoFlag: repo !== '' ? repo : undefined, startDir: import.meta.dirname })
    return cli
  } catch (error) {
    console.error(`relates-ab: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

/** Minimal `--key value` / `--flag` parsing. */
function parseArgs(argv) {
  const out = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = key === 'n' ? Number.parseInt(next, 10) : next
      index += 1
    } else {
      out[key] = true
    }
  }
  return out
}

function formatRunLine(row) {
  if (row.driverError !== undefined) return `driver error (${row.driverError})`
  const m = row.metrics
  if (m === null) return `no trace (exit ${row.exitCode}${row.timedOut ? ', timed out' : ''})`
  return `exit=${row.exitCode} ok=${m.success} search<target=${m.searchCallsBeforeTarget} distractorReads=${m.distractorReads} total=${m.totalToolCalls} injected=${m.injectionSeen} guard=${m.guardOk}`
}

/** Aggregate per case × arm over guard-clean, trace-bearing runs. */
function summarize(runRows) {
  const groups = new Map()
  for (const row of runRows) {
    if (row.metrics === null || row.metrics === undefined) continue
    const key = `${row.caseKey}/${row.armId}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return [...groups.entries()].map(([key, groupRows]) => {
    const clean = groupRows.filter(row => row.metrics.guardOk === true)
    const reached = clean.filter(row => row.metrics.targetRead)
    return {
      key,
      runs: groupRows.length,
      guardFailures: groupRows.length - clean.length,
      successRate: rate(clean.map(row => row.metrics.success)),
      targetReachRate: rate(clean.map(row => row.metrics.targetRead)),
      medianSearchBeforeTarget: median(reached.map(row => row.metrics.searchCallsBeforeTarget)),
      medianDistractorReads: median(clean.map(row => row.metrics.distractorReads)),
      distractorReadRate: rate(clean.map(row => row.metrics.distractorReads > 0)),
      medianTotalToolCalls: median(clean.map(row => row.metrics.totalToolCalls)),
    }
  })
}

function rate(values) {
  if (values.length === 0) return null
  return values.filter(Boolean).length / values.length
}

function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function renderSummary(summaryRows) {
  const lines = ['| case/arm | runs | guard fail | success | reached target | median search<target | distractor-read rate | median distractor reads | median total calls |', '|---|---|---|---|---|---|---|---|---|']
  for (const row of summaryRows) {
    lines.push(`| ${row.key} | ${row.runs} | ${row.guardFailures} | ${fmt(row.successRate)} | ${fmt(row.targetReachRate)} | ${fmt(row.medianSearchBeforeTarget)} | ${fmt(row.distractorReadRate)} | ${fmt(row.medianDistractorReads)} | ${fmt(row.medianTotalToolCalls)} |`)
  }
  return lines.join('\n')
}

function fmt(value) {
  return value === null || value === undefined ? '—' : String(value)
}

function stamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, '-')
}
