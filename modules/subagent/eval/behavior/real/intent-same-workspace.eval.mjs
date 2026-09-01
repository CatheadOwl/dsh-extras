/**
 * 双工具路由意图测试（real 模型）：同工作区内的委派任务必须走原生
 * `subagent`，不能误入目录定向的 `subagent_at`。任务刻意只提"子代理/委派"，
 * 不提任何其它目录——两个工具同时可见时，模型应稳定选默认路径。
 *
 * 注意：这条会真实拉起一个 in-process 子代理（一次额外模型调用），
 * 任务保持最小以控成本。
 */
import { firstTool, toolNotCalled } from '../../../../../eval/src/index.mjs'

export default {
  id: 'subagent-at-intent-same-workspace',
  mode: 'real',
  task: '把一个独立小任务委派给子代理：检查当前工作区根目录有哪些顶层条目，返回一句话总结。等它做完再回复我。',
  expect: [
    firstTool('subagent'),
    toolNotCalled('subagent_at'),
  ],
}
