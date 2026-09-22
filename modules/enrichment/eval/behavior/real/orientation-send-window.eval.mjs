/**
 * Real locate case, orientation variant (owner scenario ①): the prompt
 * mentions a real directory (services/notify) and asks for the send-window
 * rule. A bare grep for 发送窗口 hits three files (current templates,
 * channels, the deprecated twin); the breadcrumb chain's descriptions name
 * templates.md as the rule's home and mark the legacy tree frozen — the
 * treatment arm should read the target with little or no searching, the
 * control arm must disambiguate by opening files. Arm-neutral success
 * criterion: the final answer quotes the CURRENT marker sentence. Metrics
 * and arm guards live in the A/B driver. Requires a credential;
 * auto-skips otherwise.
 */
import { finalTextIncludes } from '@catheadowl/dsh-eval'

import { MARKER, seedDocTree } from './_fixtures/seed-doc-tree.mjs'

/** Driver guard expectation: mentions a path → treatment arm must inject. */
export const expectsInjection = true

export default {
  id: 'prompt-relates-real-orientation-send-window',
  mode: 'real',
  task: 'services/notify 下发送窗口的规则具体是什么？引用一句原文。',
  // Case-level disableRows overrides the package config default, so the
  // gates row (blocking in the non-git fixture workspace) and the
  // staged-home REQUEST_EXTENSION suspect are both restated explicitly.
  disableRows: ['gates', 'plugin-package-inventory-deepseek'],
  timeoutMs: 240_000,
  async prepare(workspace) {
    seedDocTree(workspace)
  },
  expect: [
    finalTextIncludes(MARKER),
  ],
}
