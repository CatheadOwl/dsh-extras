/**
 * Real locate case, triage variant (owner scenario ②): the prompt mentions
 * the deprecated/current twin pair together and asks which send-window rule
 * is live. The disposition (现行 vs 已废弃，2024-06 冻结) lives ONLY in the
 * directory README descriptions — file bodies look plausible either way and
 * grep cannot rank them — so the treatment arm can triage from the injected
 * breadcrumb chain while the control arm must open files to tell them
 * apart. Arm-neutral success criterion: quote the CURRENT marker sentence.
 * The driver additionally counts reads of the deprecated twin (a
 * well-oriented agent should not need it). Requires a credential;
 * auto-skips otherwise.
 */
import { finalTextIncludes } from '@catheadowl/dsh-eval'

import { MARKER, seedDocTree } from './_fixtures/seed-doc-tree.mjs'

/** Driver guard expectation: mentions paths → treatment arm must inject. */
export const expectsInjection = true

export default {
  id: 'prompt-relates-real-triage-deprecated-twin',
  mode: 'real',
  task: 'services/notify-legacy/templates.md 和 services/notify/templates.md——现在线上生效的发送窗口规则是哪条？引用一句原文。',
  disableRows: ['gates', 'plugin-package-inventory-deepseek'],
  timeoutMs: 240_000,
  async prepare(workspace) {
    seedDocTree(workspace)
  },
  expect: [
    finalTextIncludes(MARKER),
  ],
}
