/**
 * Model-facing wording for `subagent_at`, aligned verbatim with the native
 * `tool-subagent` one-shot wording. Lives in its own module so the row's
 * loader entry stays on the loader contract while the drift-guard test keeps
 * importing the single SSOT.
 */

/**
 * Model-facing wording, aligned verbatim with the native `tool-subagent`
 * one-shot / no-background wording (SSOT: `providerWording(false)` in
 * `packages/subagent/tool-subagent/src/index.ts`). Keep the native base and
 * suffix byte-identical when the host wording changes; the ONLY additions
 * are the directory-targeting hint between them and the `cwd` parameter.
 */
const NATIVE_ONE_SHOT_BASE =
  'Delegate a self-contained task to a subagent (a separate agent that works in its own context) '
  + 'to offload focused, independent work — research, a scoped '
  + 'implementation, an analysis — so it does not consume this conversation\'s context. The subagent '
  + 'returns its result, not its intermediate steps. Give it a '
  + 'complete, standalone prompt: it does not see this conversation.'

const DIRECTORY_TARGET_HINT =
  ' This variant starts the subagent in a target directory you provide (`cwd`): the subagent\'s '
  + 'workspace becomes that directory, so it loads that directory\'s entry files (AGENTS.md/CLAUDE.md) '
  + 'and works under that project\'s conventions. Use it only when the task must run against a '
  + 'different directory or project; for subtasks inside the current workspace use the regular '
  + '`subagent` tool.'

/** Native foreground suffix (the `enableRunInBackground: false` branch). */
const NATIVE_FOREGROUND_SUFFIX = ' This call waits for the subagent and returns its result.'

/** Native one-shot background suffix (the `enableRunInBackground: true` branch). */
const NATIVE_BACKGROUND_SUFFIX =
  ' This call waits for the result by default. Set `run_in_background: true` to return a job id; collect with `job_output` and stop with `job_kill`.'

/**
 * Top-level routing guidance for `subagent_at`, registered as a system-prompt
 * section (order 116.6) — the model-facing counterpart of the host
 * `tool-subagent` sections. The host wording ("Use X in the background by
 * default") carries continuable semantics and does NOT apply here: this tool
 * is one-shot and foreground by default. The section leads with the tool's
 * value — the subagent reuses the target directory's context, its entry files
 * (AGENTS.md/CLAUDE.md) and project conventions — then states the trigger
 * condition and the same-workspace route, mirroring {@link DIRECTORY_TARGET_HINT}
 * so description (schema-side contract) and section (top-level mental model)
 * share one routing truth.
 */
export const SYSTEM_PROMPT_TEXT =
  'Use the `subagent_at` tool when a task must run against a different directory or project: '
  + 'the subagent starts in that directory and reuses its context — entry files '
  + '(AGENTS.md/CLAUDE.md) and project conventions. '
  + 'For subtasks inside the current workspace, use the regular `subagent` tool.'

/**
 * Model-facing description for the given background enablement, aligned with
 * the native one-shot wording.
 * @internal Exported for the drift-guard test; not part of the plugin's model
 *   surface. Consume the registered tool's `description` instead.
 */
export function toolDescription(backgroundEnabled: boolean): string {
  return NATIVE_ONE_SHOT_BASE + DIRECTORY_TARGET_HINT + (backgroundEnabled ? NATIVE_BACKGROUND_SUFFIX : NATIVE_FOREGROUND_SUFFIX)
}

/** Native `prompt` parameter wording, verbatim. */
export const PROMPT_DESCRIPTION =
  'The complete, self-contained task for the subagent. It does not share this '
  + 'conversation\'s context, so include everything it needs.'
