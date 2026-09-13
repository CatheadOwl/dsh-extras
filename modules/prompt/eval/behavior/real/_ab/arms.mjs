/**
 * Row-config baseline and trace metrics for the relates A/B experiment
 * (workunits/prompt-middleware/probe/20260905-relates-behavior-ab.md).
 *
 * Arms live in the experiment definition (run-relates-ab.mjs): the case-level
 * baseline below restates the extras bundle's prompt-row config (cordis patch
 * config override is whole-replace — see @catheadowl/dsh-eval
 * docs/rowconfig.md; the values mirror the extras bundle's own
 * `cordis.patch.yml` prompt row), and the control arm overrides ONLY
 * `disabledProviders` — the framework's experiment surface deep-merges the
 * override onto the baseline, so the differing key alone is enough.
 */

/** The provider the control arm disables. */
export const TREATED_PROVIDER = 'breadcrumb-description-enricher'

/** Loader row id of prompt-middleware in the extras bundle patch. */
export const PROMPT_ROW_ID = 'prompt'

/** The extras bundle's prompt-row config (case-level baseline, restated
 * under whole-replace). */
export const PROMPT_ROW_CONFIG = {
  providerTimeoutMs: 2000,
  totalTimeoutMs: 5000,
  renderBudgetChars: 4000,
}

/** Tool names counted as "search" for the H1 metric. */
const SEARCH_TOOLS = new Set(['grep', 'glob'])

/** Tool names that read file contents. */
const READ_TOOLS = new Set(['read'])

/**
 * Extract the per-run metrics from one run trace.
 *
 * @param {{ toolCalls?: { seq: number, name: string, arguments: string }[],
 *           userMessages?: { seq: number, source: object, text: string }[] }} trace
 *   the EvalTrace shape produced by @catheadowl/dsh-eval (field table in its
 *   matchers doc); only the projections used here are declared.
 * @param {{ targetPath: string, marker: string, avoidPaths?: readonly string[] }} spec
 */
export function extractMetrics(trace, spec) {
  const calls = trace?.toolCalls ?? []
  const firstTargetReadSeq = seqOfFirstRead(calls, spec.targetPath)
  const searchCallsBeforeTarget = calls.filter(
    call => SEARCH_TOOLS.has(call.name) && (firstTargetReadSeq === undefined || call.seq < firstTargetReadSeq),
  ).length
  const totalSearchCalls = calls.filter(call => SEARCH_TOOLS.has(call.name)).length
  const distractorReads = (spec.avoidPaths ?? []).filter(
    avoid => calls.some(call => READ_TOOLS.has(call.name) && readTouches(call, avoid)),
  ).length
  const injectionSeen = (trace?.userMessages ?? []).some(
    message => message.source?.plugin === 'prompt-middleware' && message.text.includes('relates:'),
  )
  const finalText = trace?.finalText ?? ''
  return {
    targetRead: firstTargetReadSeq !== undefined,
    searchCallsBeforeTarget,
    totalSearchCalls,
    distractorReads,
    totalToolCalls: calls.length,
    turns: calls.length === 0 ? 0 : Math.max(...calls.map(call => call.turn)),
    success: finalText.includes(spec.marker),
    injectionSeen,
  }
}

/** First `read` call touching the target path (seq), or undefined. */
function seqOfFirstRead(calls, targetPath) {
  for (const call of calls) {
    if (!READ_TOOLS.has(call.name)) continue
    if (readTouches(call, targetPath)) return call.seq
  }
  return undefined
}

/** Whether one `read` call's file_path touches the given workspace-relative path. */
function readTouches(call, relativePath) {
  const filePath = call.parsedArguments?.file_path ?? ''
  const normalized = String(filePath).replaceAll('\\', '/')
  return normalized.includes(relativePath)
}
