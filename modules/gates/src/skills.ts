/**
 * gates config-guide skill: a user-invocable skill whose body distills the
 * repo-declared `gates.yml` cookbook (`docs/adding-a-repo-gate.md`) plus the
 * execution facts a writer needs (discovery, forms, fields, verification,
 * pitfalls). Registered user-only, the inverse of coggit's model-only
 * handbooks: a human pulls the guide in with the `/gates-config-guide`
 * gesture when they want to create/understand/edit `gates.yml`; the model
 * catalog and `skill` tool never advertise it.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the `ctx.skills` Context augmentation; the registry
// service itself is provided by the host profile. No runtime import.
import type {} from '@deepseek-ai/dsh-skill'

/** Skill name for the `/gates-config-guide` user gesture. */
export const GATES_CONFIG_GUIDE_SKILL_NAME = 'gates-config-guide'

const GATES_CONFIG_GUIDE_CONTENT = `# gates.yml 配置指南（gates 插件）

本指南指导你创建、理解、编写 gates 插件（\`@catheadowl/dsh-extras\`）的仓库级配置文件
\`gates.yml\`。用户显式调用本 skill（\`/gates-config-guide\`）时按此操作。

## 1. gates.yml 是什么

\`gates.yml\` 是**项目根目录**的声明式 gate 配置文件：不写插件代码，声明即生效。
一个 gate 是自描述的工作单元：check（纯读检测）+ rationale（为什么存在、为什么手改安全）
+ remedy（修复指引）。\`gates.yml\` 归**项目**所有，gates 插件只是执行载体
（与 hooks.json 归项目同构）。

发现与生命周期规则：

- 每次执行按**会话工作区根**发现 \`gates.yml\`；没有该文件的工作区什么检查都不跑
  （检查永不跨工作区泄漏）。
- \`gates.yml\` 按 mtime 缓存：修改后下一轮即生效，**无需重启**。
- 解析失败不会静默：会以一个专用 \`gates-config\` blocking gate 报错，驱动修复配置文件本身。
- \`gates-config\` 是内部保留 id，项目级 gate 不能声明该 id。

## 2. 两种 gate 形态

在项目根建 \`gates.yml\`，\`gates\` 列表声明 gate。每条 gate 二选一提供执行体：

### 2.1 module（in-process，首选）

\`\`\`yaml
# <项目根>/gates.yml
gates:
  - id: md-metadata              # kebab-case，全局唯一，重名注册即报错
    module: scripts/md-metadata-lib.mjs   # 相对会话工作区根解析
    description: 一句话，进列表与失败反馈标题
    rationale: >-
      为什么存在这个检查 + 为什么手改是安全的。
      只在失败时注入模型，平时零成本——写清动机，别怕长。
\`\`\`

module 指向的模块需导出**通用表面**：

- **通用形状**：\`check(root, changes?): GateViolation[]\`（或返回 Promise）；
  \`changes\` 是可选会话变更集 \`{paths: string[], opaque: boolean}\`——\`paths\` 为
  本轮 \`write\`/\`edit\` 触及的路径（自上次干净通过累计），\`opaque\` 为出现不透明写
  （bash/subagent）导致 \`paths\` 不全；仅 stop 档提供，手动入口传 \`undefined\`。

### 2.2 command（shell，兜底）

\`\`\`yaml
  - id: my-lint
    command: node scripts/lint.mjs
    level: advisory        # 可选，默认 blocking
    timeoutMs: 60000       # 可选，默认 120000
\`\`\`

退出码 0 = 通过；非零 = 失败，stdout+stderr（截断 4000 字符）作为违规原因进入反馈。
挂死会被超时 kill 并按失败收敛，不会卡住轮次。

命令可经环境变量 \`GATE_CHANGES\` 读取会话变更集（JSON，\`{"paths":[...],"opaque":bool}\`）；
manual 入口不注入该变量。

## 3. 字段速查

| 字段 | 必需 | 说明 |
|------|------|------|
| \`id\` | ✓ | kebab-case；全局唯一；重名、非法或使用保留 id 即报错 |
| \`module\` / \`command\` | 二选一 ✓ | 都没有 → 物化时 fail loud |
| \`description\` | 建议 | 列表/反馈标题 |
| \`rationale\` | 建议 | 失败时注入的设计说明 |
| \`level\` | 可选 | \`blocking\`（默认）/ \`advisory\` / \`defer\` |
| \`timeoutMs\` | 可选 | 默认 120000 |
| \`relevant\` | 可选 | 增量短路相关性模式（如 \`['*.md']\`）；仅精确脏轮里与脏路径无关时复用上轮通过结果 |
| \`fixer\` | 可选 | 仅 \`defer\` 档合法；两变体：\`{ kind: 'subagent', prompt, request? }\` 派继承上下文的子 agent 离线修（\`prompt\` 静态指令、派发时自动追加失败文件清单，\`request\` 透传 \`provider\`/\`persona\`/\`toolFilter\`/\`agentOptions\`）；\`{ kind: 'command', command }\` 同步跑脚本（cwd=工作区根、带超时），非零退出记入快照 |

## 4. 触发与执行语义（写配置前要知道的）

- **\`stop\` 档**（每个轮次要关闭时，\`agent/turn-stopping\` 检查点）：通过时静默，
  失败才阻断——注入 rationale + 定位列表，机器续步修复；连续阻断默认 3 次耗尽后降级放行。
- **\`manual\` 档**：仅显式调用（模型调 \`gates_run\` 工具或人打 \`/gates\` 命令）时跑。
- **增量短路（W2）**：上次干净通过后，本轮无脏变更 → 整个扫描跳过；仅精确脏变更时，
  声明了 \`relevant\` 且与脏路径无关的 gate 复用上轮 passed 结果（记 \`skipped\`）。
  失败结果永不短路：修复后必须真跑确认。
- **advisory**：\`level: advisory\` 的 gate 照常执行与报告，但**永不触发 steer**。
- **defer**：\`level: defer\` 的 gate 失败时记入进程内脏状态、**不触发
  steer**（旁路），turn 立即关闭；脏窗口保持 dirty，下轮重扫直到通过。声明了
  \`fixer\` 时还会离线修（「旁路执行」）：\`subagent\` 变体派一个继承会话上下文的子 agent，
  \`command\` 变体同步跑修复脚本（非零退出保持脏窗口），不声明则只记脏状态。适合「必须补、但不必
  现在打断主会话」的检查——典型例子是
  \`md-metadata\`（写 md 必须带 \`description\` frontmatter；description 是语义，不能机械
  提取，故 fixer 必须是带上下文的 LLM 而非脚本）。注意：\`level\` 词汇表在插件加载时定死，
  新增 \`defer\` 需重启 host。
- 违规列表注入模型时截断为前 20 条（\`...and N more\`）。

## 5. 验证（写完怎么确认生效）

1. \`gates.yml\` 落盘后（无需重启）：人打 \`/gates\` 或让模型调 \`gates_run\` 看聚合输出；
2. 故意制造一条违规 → 轮末应被拦截并收到定位 + rationale + fix 指引；
3. 修复后再次收尾应静默通过。

## 6. 坑

- **module 受 Node import 缓存**：会话期间改 gate 模块不生效，需重启进程
  （\`gates.yml\` 本身不受此限，按 mtime 重载）。
- **\`level\` 词汇表在插件加载时定死**：新增 level（如 \`defer\`）需重启 host，
  仅改 \`gates.yml\` 不够（\`gates.yml\` 按 mtime 热读不受此限，但 level 白名单在
  插件加载时读入）。
- **完整可跑的 module 形态参考实现**：\`examples/md-metadata/module-form.mjs\`
  （冻结标本，可直接 \`module:\` 指向或拷走改 id）。
- 慢检查优先优化自身或声明 \`relevant\`（精确脏轮可跳过无关检查，无脏轮整体短路）；
  仍慢则调 \`level: advisory\`。
- 手动入口（\`gates_run\` / \`/gates\`）总是全扫，且不回写轮末脏状态
  （手动通过不会让下个轮末短路，保守方向）。
- **仓库级 id 与插件级 gate 撞名会 fail loud**：示例 id \`md-metadata\` 已被
  \`@catheadowl/dsh-extras\` markdown 模块插件级注册（defer + subagent fixer，装该包的
  profile 自带）；要声明自己的等价检查需换 id，或直接复用插件 gate 不再声明。
`

/**
 * Register the user-only config-guide skill via soft dependency injection:
 * a profile without `dsh-skill` keeps gates fully functional minus the skill,
 * matching the plugin's conditional-injection stance (same shape as the
 * `ctx.inject(['commands'], ...)` registration of `/gates`).
 */
export function registerGatesConfigGuideSkill(ctx: Context): void {
  ctx.inject(['skills'], (skillCtx) => {
    skillCtx.skills.register({
      name: GATES_CONFIG_GUIDE_SKILL_NAME,
      description: 'gates 配置指南：创建、理解、编写仓库级 gates.yml（用户显式调用）',
      whenToUse: '当用户想创建、理解或修改 gates 插件的仓库级配置文件 gates.yml 时，由用户通过 /gates-config-guide 显式调用',
      source: 'custom',
      content: GATES_CONFIG_GUIDE_CONTENT,
      invocation: { modelInvocable: false, userInvocable: true },
    })
  })
}
