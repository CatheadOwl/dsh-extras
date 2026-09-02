---
description: gates 插件的运行时执行模型：stop/manual 触发时机、blocking/advisory/defer 三级语义与失败反馈形状
---

# 执行模型：触发时机、级别与反馈

> 前置阅读：[../README.md](../README.md) 的「架构：两种 gate 注册形态」。
> 本文只讲**运行时行为**；怎么加 gate 见 [adding-a-repo-gate](adding-a-repo-gate.md)
> 与 [adding-a-plugin-gate](adding-a-plugin-gate.md)。

## 时机两档

| `on` | 何时跑 | 语义 |
|------|--------|------|
| `stop` | 每个轮次要关闭时（`agent/turn-stopping` serial 检查点） | 制度化检查：模型无需知晓，到点就跑 |
| `manual` | 仅模型调 `gates_run` 或人打 `/gates` 时 | 主动自检入口 |

`gates_run` 会把工具执行的 `signal` 传入服务面；已取消时未开始的 gate 记 `skipped`。

`stop` 档挂在每个轮末，但四层过滤保证"平时无察觉"：

1. **增量短路**（W2）：上次干净通过后，本轮无脏变更 → 整个扫描跳过；
2. 只跑 `on` 含 `stop` 的 gate；
3. 全通过 → 静默返回，零输出、零续步；
4. 仅 `level: 'blocking'` 的失败会阻断（见下）。

## 用户开关（配置面）

Settings → Plugins → Gates（Web）渲染当前工作区的**扁平 gate 列表**，每个 gate 按其声明的
`on` 显示**两个独立开关**——**轮末**（`stop` 维：固定、强制，轮次关闭时自动跑）与
**手动**（`manual` 维：agent 自行选择，`gates_run`/`/gates` 时跑）。开关双列表由
**浏览器 localStorage** 持久化（key `dsh.gates.disabled`，JSON `{stop, manual}` 双 id 列表），
host 侧只有内存镜像：页面加载（每次打开/刷新该标签页）与每次拨动开关时，UI 把整个双列表推给
`gates/setDisabled`，host 据此按维度执行过滤。被关掉的那一维**不进入对应执行路径**：

- 关**轮末**维：`service.runnableDefinitions(root, 'stop')` 直接过滤，轮末不再跑它；
- 关**手动**维：`gates_run` / `/gates` 的 run-all 同样过滤；显式单跑一个被关手动维的
  gate（`gates_run {gate}` / `/gates <id>`）**fail loud**——报"已在设置中禁用手动运行"，
  不静默放行（开关即契约，无静默覆盖）；
- `on` 是作者声明上界：gate 未声明某 trigger 就不显示该维开关，用户只能收窄、不能扩宽。

host 重启后内存清空，但浏览器里开关仍在——GUI 一加载（标签页打开/刷新）即重推，
恢复原状。不开 GUI 的 headless 运行没有开关状态，全部 gate 照常跑。列表按 gate id
全局生效（不按工作区分），id 已不存在的项无害（匹配不到任何 gate）。

## 执行链（stop 档）

```
轮次要关闭
  → selectGates(注册的全体, 'stop')
  → runGates 串行（每个 gate 受各自 timeoutMs 约束；payload.signal 取消时未跑的记 skipped）
  → collectBlockingFailures（只留 blocking 且 failed）
  → 无失败：重置该 agent 的连续阻断计数，轮次正常关闭
  → 有失败：预算状态机判定
      → 未超限：steer 注入反馈文本，机器再跑一步（模型修复）
      → 已超限：降级放行 + console.warn（不无限续步）
```

要点：

- **预算**：每个 agent 独立的连续阻断计数（`WeakMap<Agent, number>`），
  默认上限 3（Config `maxConsecutiveBlocks`）；通过后归零，耗尽后归零重启
  循环。宿主 Stop hook 没有此守卫（`TODO(stop-loop-guard)`），gates 自始内建。
- **超时**：Config 声明的 gate 默认 `timeoutMs: 120_000`；超时按
  `failed` + 归因错误收敛（"检查失败不崩宿主"），command 形态超时还会
  `kill` 子进程。插件注册的 gate 可自带 `timeoutMs`。
- **advisory**：`level: 'advisory'` 的 gate 在 `stop` 档照常执行、照常
  报告，但**永不触发 steer**——适合"想知道但不拦"的检查。
- **defer**：`level: 'defer'` 的 gate 在 `stop` 档失败时**不触发 steer**（旁路）：
  按 gate 声明的 `fixer` 离线修——`subagent` 变体派一个继承会话上下文的子 agent、
  `command` 变体同步跑修复脚本；无 `fixer` 或 `command` 修复失败则记录在进程内脏状态。
  turn 立即关闭，下次轮末照常重扫，直到通过。
  适合「必须补、但不必现在打断主会话」的检查。

> **结果归宿**：gates 是无状态插件——每轮重评估即唯一 truth source。
> defer/advisory 失败记录在进程内脏状态（`state.dirt` / `state.blocks`），
> 下一轮重扫时自愈。不写 session event，不写文件台账。

## defer 旁路：设计原理

三个 level 是 turn-stopping 检查点上的三种**去向**，不是三种强度：

| level | 去向 | 打断 turn？ | 谁看到 |
|-------|------|------------|-------------|
| `blocking` | `agent.steer()` inline 反馈 | 是（预算内续步） | 模型立即 |
| `defer` | `fixer`（subagent 或 command 直接修）；无 fixer 则仅记进程内脏状态 | 否（旁路） | fixer 子 agent/脚本直接修；失败留在脏状态，下轮重扫 |
| `advisory` | 无自动目的地 | 否 | 仅 manual `/gates`/`gates_run` |

> **去向已收敛**：上表是当前实现。

**为什么需要 defer**：像 `md-metadata`（「写 md 必须带 `description` frontmatter」）
这类纪律检查，用 blocking 会让每次触碰 md 都强行续步、打断主会话、体验差——它
「必须补、但不必现在打断」。defer 不触发续步，turn 立即关闭。

**旁路执行（fixer）**：defer 只是「不打断」；「最终被修」由 gate 可选的 `fixer`
承担。`fixer` 是两变体 union（契约见开发仓库 `workunits/gates/spec/gate-fixer.md`）：

- **`subagent`**（语义修复，LLM + 继承父上下文）：`fixer: { kind: 'subagent', prompt, request? }`。
  turn-stopping 会 `ctx.subagents.start(request?.provider ?? 'fork', { parent, prompt + 失败文件清单, maxDepth: 1, persona?, toolFilter?, agentOptions? })`
  派一个 fork subagent——它继承主会话到上一轮 `turn/end` 的已完成轮次（带着项目上下文），
  再 `read` 失败文件、按 `prompt` 离线补修，主轮立即关闭。`request` 是作者透传给 seam 的
  叠加字段（`provider`/`persona`/`toolFilter`/`agentOptions`）；`parent`/`signal`/`label`/
  `maxDepth:1` 由 gates 注入、作者不可改。**subagent 档失败直接进快照**：失败信息直接进
  subagent 的 prompt，重扫循环由内存脏窗口驱动。为什么用 subagent 而不是
  脚本：`description` 这类修复是**语义**任务，不能机械提取，只能由带上下文的 LLM 写。
- **`command`**（确定性修复，脚本）：`fixer: { kind: 'command', command }`。turn-stopping
  同步内联（await，带超时，cwd=会话工作区根，复用 `runCommand`）；不做 fire-and-forget
  （那是 subagent 的语义）。非零退出 = 修复失败 → 保持脏窗口，下轮快照照常重扫。

**进程内状态**：defer 失败的脏窗口（`hasPassed`、`dirt`、`blocks`）存在进程内
`Map<root, GateState>`，不写 session event，不写文件。进程重启后脏状态丢失，
下一轮重扫会重新发现违规并派 fixer——多派一次 fixer 是可接受的代价。

**服务面复用**：修复派发不是 turn-stopping 驱动的私有步骤，而是 `ctx.gates` 服务方法
`repair(root, failures, {agent, signal?})`（「离线自愈」半边）与 `runAndRepair(root, {...})`
（「检查 + 离线自愈」一步）——驱动只调 `repair`，其他依赖 gates 的 CI 可直调同一服务面，
不必复制派发逻辑。

**协作模式**：defer 失败**不重置脏窗口**（`hasPassed` 保持 false、`dirt` 不清），
所以下个轮末该 gate 必然重扫；fixer 子 agent 在独立 session 里改文件（不进父 session
的变更集），但 gate 从磁盘重读文件内容，因此「子修完 → 下轮重扫读到已修 → 通过」。子修失败
则下轮仍失败、重派一个子（每轮一次，有界）。无 fixer 的 defer 通过后下一轮快照自然转绿。

**递归护栏**：fixer 子 agent 继承父 preset（含 gates），它自己轮末也会跑 gate；
`maxDepth: 1` 把子限制为深度 1——子再派孙（深度 2）会被 `SubagentDepthError` 拒绝、
落快照兜底，不会无限套娃。子自己跑 gate 是低成本自校验：修对了其 gate 通过。

**当前边界（缺口）**：消费面缺口与 fixer「多次失败降级/冷却」均跟踪于开发仓库
workunit TODO（gate-consumption-surface、gate-fixer-cooldown）。另外 `level`
词汇表在插件加载时定死：加 `level: defer` 需重启 host（`gates.yml` 本身按 mtime
热读不受此限）。

## 结果归宿

gates 是无状态插件。每轮重评估即唯一 truth source，defer/advisory 失败
记录在进程内脏状态（`state.dirt` / `state.blocks`），下一轮重扫时自愈。
不写 session event，不写文件台账。ADR 0007 决策 1/2 已降级（详见该 ADR 勘误）。

## 反馈形状

失败时注入的文本由 `formatGateFailureFeedback` 生成，每个失败 gate 一段：

```
## gate: <id> — <description>

Why this gate exists:
<rationale>                     ← 懒加载：只在这里出现，不进常驻上下文

Violations:
- <file>:<line> <reason>
  fix: <remedy guidance | operation id>
```

契约字段：`GateResult { gateId, status, durationMs, violations, error? }`，
`GateViolation { file?, line?, reason, remedy? }`，`remedy` 两档：

- `{ kind: 'manual', guidance }`——声明手改合法且怎么改（为什么安全要写清）；
- `{ kind: 'operation', operation }`——指向修复 tool，**只许 operation id**
  （hint 中性化：不许工具名/命令名/URI）。

gate 的 `check` **只读**：只检测与报告，不亲自修。修复在外部三选一：模型按
指引手改（blocking）、operation 指向的 tool、或 `fixer`（defer 档派 subagent 或
command 离线修）。

## 增量短路（W2 已落地）

事实层 SSOT 见开发仓库 `explorer/session-change-set/`；
gates 的消费契约见开发仓库 `workunits/gates/spec/gate-change-set-consumption.md`。
本节只保留运行时摘要。

脏状态按 **(agent, root) 二维**存，按 session event 索引增量扫；窗口是自上次 clean
pass 后累计，不是单 turn 临时集合。`write`/`edit` 的 `file_path` 进入精确路径；
只读白名单忽略；其余工具归不透明并强制全扫。首轮、manual 入口、不透明窗口都全扫；
仅精确脏时允许声明了 `relevant` 且无关的 gate 复用上次 **passed** 结果；失败结果永不短路。

`GateChangeSet` 只在 stop 档提供给 `check(root, changes?)`；command gate 通过
`GATE_CHANGES` 读取同一份 JSON。`gates_run` / `/gates` 永远全扫，不传 `changes`，
也不回写轮末脏状态。

## 归责过滤（W10 已落地）

决策 ADR 0008、契约
`workunits/gates/spec/gate-attribution-filter.md`（开发仓库）。
`doc-link` 在 stop 档仍整仓 `checkRepository`，但把结果按「是否可归责到本会话」过滤，
只返回可归责违规——平行会话/外部编辑的中间态不进入 steer：

- `opaque → 全算`：本轮出现不透明写（`bash`/`md_rename`/subagent，删除/移动都走这里），
  违规全算本会话（fail-closed）；
- `source ∈ 精确写集合`：本会话精确写的源文件留下断链；
- `target ∈ 精确写集合`：本会话精确写了目标文档（改了标题），别处链向它的 `#fragment`
  断掉。

机制归 md-links（`checkRepository` 的可选 `include` 谓词缝 + `canonicalPath` 规范路径），
政策归开发仓库的 `dsh-plugin-dev/extras/modules/markdown` 模块（`src/gate-check.ts` 的归责谓词，
原仓库级薄 shim 已归档）。manual 入口无
`changes` → 不过滤 → 整仓全量，即「阶段性清理」快照。驱动层零改动：`check` 少返回几个
违规，`collectBlockingFailures` + 预算状态机的 steer 自然跟着少。

## 成本模型

- 无脏轮末：短路生效，开销为增量事件扫描（目标 <5ms）；
- 实测参考（全扫时）：`doc-sync` 全仓 ~0.7s、`coggit-misplaced` ~0.3s；
- 违规列表注入模型时截断为前 20 条（`...and N more`）；command 输出
  截断为 4000 字符。

## 与 hooks 子系统的关系

同一拦截点（`agent/turn-stopping`）上的对等实现：宿主
`dsh-hooks-claude-code` 的 Stop hook 走配置文件 + 子进程 + 退出码；
gates 走插件注册 + 类型化结果 + 自描述。时机词汇表共享，互不冲突；
边界细节见 [../README.md](../README.md)。
