/**
 * A/B driver for the relates model-behavior experiment
 * (workunits/enrichment/probe/20260905-relates-behavior-ab.md).
 *
 * Built on the framework's behavior-experiment surface
 * (`defineBehaviorExperiment` / `executeBehaviorExperiment` /
 * `writeBehaviorArtifacts` from @catheadowl/dsh-eval/experimental): the
 * driver owns only the domain parts — case corpus, metric extraction, guard
 * semantics, preregistered decision rule. Arm × repeat scheduling, case-id
 * minting, deep-merged rowConfig baselines, per-run named failures,
 * zero-guard-clean INVALID arms, aggregation, and artifacts are the
 * framework's.
 *
 * Arm shape: the case-level rowConfig baseline restates the extras bundle's
 * enrichment-row config (whole-replace doctrine, docs/rowconfig.md); the control
 * arm overrides only `disabledProviders` — the framework deep-merges the
 * override onto that baseline, so naming the differing key alone now behaves
 * exactly like restating the whole config.
 *
 * Usage (from the extras package root):
 *   node modules/enrichment/eval/behavior/real/run-relates-ab.mjs [--n 10] [--cases mention] [--profile headless] [--dry]
 *
 * Requires a real-model credential and a spawn-capable host terminal (the
 * sandboxed in-session shell refuses the child dsh CLI spawns).
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  defineBehaviorExperiment,
  executeBehaviorExperiment,
  renderBehaviorSummary,
  resolveDshCliChain,
  writeBehaviorArtifacts,
} from '@catheadowl/dsh-eval/experimental'

import { ENRICHMENT_ROW_CONFIG, ENRICHMENT_ROW_ID, TREATED_PROVIDER, extractMetrics } from './_ab/arms.mjs'
import { AVOID_PATHS, MARKER, TARGET_PATH } from './_fixtures/seed-doc-tree.mjs'
import orientationCase, { expectsInjection as orientationExpectsInjection } from './orientation-send-window.eval.mjs'
import triageCase, { expectsInjection as triageExpectsInjection } from './triage-deprecated-twin.eval.mjs'

/**
 * The preregistered judgment criterion (probe v2, written before running):
 * the framework reproduces it verbatim in every summary beside the
 * definition fingerprint, so results stay traceable to preregistered rules.
 */
const DECISION_RULE = '确认 H1 当且仅当同一 case 内 treatment 的 searchCallsBeforeTarget 中位数低于 control 且 success 率不降；无差异或 success 下降记为 tricky，另行记录，不折算进结论'

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

const experiments = CASE_MODULES
  .filter(entry => args.cases === undefined || entry.key.includes(args.cases))
  .map(entry => ({
    key: entry.key,
    experiment: defineBehaviorExperiment({
      id: `relates-ab-${entry.key}`,
      hypothesis: '关联注入（breadcrumb relates）减少定位目标文件前的探索搜索，且不降低任务成功率',
      arms: [
        { id: 'treatment' },
        { id: 'control', overrides: { rowConfig: { [ENRICHMENT_ROW_ID]: { disabledProviders: [TREATED_PROVIDER] } } } },
      ],
      runs: runsPerArm,
      metrics: trace => extractMetrics(trace, SPEC),
      // Treatment: the injection state must match the case's expectation
      // (mention variant: injected). Control: the provider is disabled, so no
      // injection may appear — a leak would fake a treatment effect, a
      // silent failure a null result.
      guard: (metrics, { arm }) => metrics.injectionSeen === (arm === 'treatment' ? entry.expectsInjection === true : false),
      decisionRule: DECISION_RULE,
    }),
    baseCase: {
      ...entry.caseDefinition,
      rowConfig: { [ENRICHMENT_ROW_ID]: { ...ENRICHMENT_ROW_CONFIG } },
    },
  }))

if (args.dry) {
  const total = experiments.length * experiments[0].experiment.arms.length * runsPerArm
  console.log(`relates-ab dry run: ${total} runs (${experiments.length} cases × ${experiments[0].experiment.arms.length} arms × ${runsPerArm})`)
  for (const { experiment, baseCase } of experiments) {
    const arms = experiment.arms
      .map(arm => arm.id + (arm.overrides === undefined ? '' : ` +override ${JSON.stringify(arm.overrides.rowConfig)}`))
      .join(', ')
    console.log(`- ${experiment.id} (${baseCase.id}): ${arms}`)
    console.log(`  baseline rowConfig: ${JSON.stringify(baseCase.rowConfig)}`)
  }
  process.exit(0)
}

for (const { experiment, baseCase } of experiments) {
  console.log(`\n=== ${experiment.id} — ${experiment.runs} runs/arm, sha256 ${experiment.definitionSha256.slice(0, 12)}… ===`)
  const result = await executeBehaviorExperiment(experiment, baseCase, {
    profile: args.profile ?? 'headless',
    cliPath,
    mode: 'real',
    onRow: row => console.log(`  ${row.caseId} ok=${row.ok} guard=${row.guardOk}${row.failure === null ? '' : ` — ${row.failure}`}`),
  })
  const outDir = join(import.meta.dirname, '.runs', `${experiment.id}-${stamp()}`)
  const paths = writeBehaviorArtifacts(result, outDir)
  console.log(renderBehaviorSummary(result))
  console.log(`results: ${paths.resultsPath}`)
}

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

function stamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, '-')
}
