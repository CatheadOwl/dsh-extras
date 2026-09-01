/**
 * 双工具路由意图测试（real 模型）：任务明确指向另一个目录时，模型应选
 * `subagent_at` 而不是原生 `subagent`——这是"看到两个 subagent 会不会疑惑"
 * 的正向用例。
 *
 * 说明：本条只断言工具选择（tool/call 事件），**不验证端到端结果内容**——
 * 子进程失败时错误会回流为工具结果、turn 照常 exit 0，意图断言照过（见
 * Gremlins 20260822-1521 经验 2）；端到端内容由人工暗号取证覆盖。
 */
import { firstTool, toolCallArgs } from '../../../../../../eval/src/index.mjs'

export default {
  id: 'subagent-at-intent-cross-directory',
  mode: 'real',
  // 同 intent-same-workspace：eval 工作区非 git 仓库，gates 关掉。
  gates: 'off',
  // 端到端时会真拉子运行时（进程启动 + 握手 + 完整一轮），留足预算。
  timeoutMs: 300_000,
  task:
    '请用目录定向的子代理（在目标目录里启动的那种）去分析 D:/Document/Projects/dsh/deepseek-harness 这个项目：'
    + '只回答它的顶层目录有哪些，一句话即可。',
  expect: [
    firstTool('subagent_at'),
    toolCallArgs('subagent_at', args => typeof args.cwd === 'string' && args.cwd.length > 0),
  ],
}
