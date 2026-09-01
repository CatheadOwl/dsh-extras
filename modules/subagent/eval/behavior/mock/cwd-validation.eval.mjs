/**
 * 确定性层：脚本化模型发起一次空 `cwd` 的 `subagent_at` 调用，走真实工具
 * 管线，且没有任何委派启动。无需 API key。
 *
 * `toolResultIsError('subagent_at')` 直接断言空 cwd 产生错误结果，
 * fail-loud 语义由 eval 框架而非单元测试独力兑底。
 */
import { firstTool, toolResultIsError, finalTextIncludes, toolCallStep, textStep } from '../../../../../../eval/src/index.mjs'

export default {
  id: 'subagent-at-mock-cwd-validation',
  mode: 'mock',
  // eval 临时工作区不是 git 仓库，gates 的 doc-link 门在其中只会以
  // git 报错成 blocking 并注入反馈步骤，耗尽脚本步数——一律关掉。
  gates: 'off',
  task: 'eval driver: scripted empty-cwd validation',
  script: {
    steps: [
      toolCallStep('subagent_at', { description: 'probe', prompt: 'do it', cwd: '' }),
      textStep('Mock evaluation complete.'),
    ],
  },
  expect: [
    firstTool('subagent_at'),
    toolResultIsError('subagent_at'),
    finalTextIncludes('Mock evaluation complete.'),
  ],
}
