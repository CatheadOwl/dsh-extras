/**
 * 确定性层：脚本化模型直接回复一段文本（不调用任何工具），走真实
 * headless 装配管线，然后断言 `request/header` 投影——system prompt 里
 * 含 `subagent_at` 的顶层引导 section，且工具列表里挂载了 `subagent_at`。
 * 无需 API key。
 *
 * 这是「插件顶层 section 注入」的回归锁定：注册在 `apply()` 的
 * `ctx.systemPrompt.section({ name: 'tool:subagent_at', order: 116.6 })`
 * 必须每步出现在组装后的系统提示词里，模型才能看到跨目录触发条件。
 */
import { textStep, systemPromptIncludes, toolMounted, finalTextIncludes } from '../../../../../eval/src/index.mjs'

export default {
  id: 'subagent-at-mock-system-prompt-section',
  mode: 'mock',
  task: 'eval driver: scripted system-prompt inspection',
  script: {
    steps: [
      textStep('Mock evaluation complete.'),
    ],
  },
  expect: [
    systemPromptIncludes(
      'Use the `subagent_at` tool when a task must run against a different directory or project',
    ),
    toolMounted('subagent_at'),
    finalTextIncludes('Mock evaluation complete.'),
  ],
}
