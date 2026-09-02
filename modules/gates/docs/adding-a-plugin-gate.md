---
description: 插件通过 registerGate 注册 gate 的配方——@catheadowl/dsh-extras/gates/register 硬导入面 + 软服务依赖 + 返回 disposer，含模板与契约边界行为
---

# 配方：插件注册自己的 gate（软依赖）

> 适用：检查逻辑属于**某个插件**（如一致性、镜像对齐、通用健康检查），应随插件安装/
> 卸载自动生效/回滚。类比“把 gates 当软依赖开发的 native-like hook”：
> 仍是普通插件间协作，不要求宿主内置 gate 包。
> 仓库级检查（不依赖插件存亡）看 [adding-a-repo-gate](adding-a-repo-gate.md)。

## 三条纪律

公共 import、类型与 generated API 表见 [register](register.md)。本页保留任务配方与验证步骤。

1. **硬包依赖 + 软服务依赖**：`package.json` 的 `dependencies` 声明
   `@catheadowl/dsh-extras`（`link:` 同层 gates），import
   `{ registerGate } from '@catheadowl/dsh-extras/gates/register'`（ADR 0003 硬导入面，
   取代早期的结构 `*Like` 镜像 + 手写 `ctx.inject` + `declare module` 仪式）。
   `registerGate` 内部走 `ctx.inject(['gates'], …)` 条件注入——profile 未装 gates 时
   你的插件照常加载、只是不注册。**禁止**把 `gates` 写进插件自己的硬 `inject` 数组。
2. **类型面只 import type**：`GateDefinition` / `GateViolation` 等从
   `@catheadowl/dsh-extras/gates/register` **type-only** import（编译期擦除），运行时只留
   `registerGate` 一个符号——两个包各自独立编译，不互相捆绑。
3. **disposer 由 `registerGate` 接进 fiber 生命周期**：`registerGate` 把 `register` 的
   disposer 作为 `ctx.inject(['gates'], …)` 回调的返回值交还 Cordis fiber（fiber 卸载时
   自动清理；gates 注册表是纯 Map、无 effect 跟踪，disposer 是**唯一**回滚通道）。
   若手写 `ctx.inject` 仪式（早期形态），丢弃回调返回值 → 热重载重名报错、卸载后
   gate 永久残留（有 repro 实证，见会议纪要 Q4/code review 记录）。

## 模板（照抄改三处）

```ts
import type { Context } from '@deepseek-ai/cordis'
import { registerGate } from '@catheadowl/dsh-extras/gates/register'
import type { GateChangeSet, GateDefinition, GateViolation } from '@catheadowl/dsh-extras/gates/register'

// 1) gate 定义：rationale 写清"为什么存在 + 为什么手改安全"
const MY_GATE: Omit<GateDefinition, 'check'> = {
  id: 'my-plugin-consistency',
  description: '一句话，进列表与失败反馈标题',
  rationale: '设计说明（失败时才注入，平时零成本）……',
  on: ['stop', 'manual'],
  level: 'blocking',
}

// 2) check：只读检测；root 是会话工作区根（运行时事实），changes 是 stop 档变更集
async function check(root: string, changes?: GateChangeSet): Promise<GateViolation[]> {
  return []
}

// 3) 在插件 apply 里调用；registerGate 内部 return 了 register 的 disposer
export function apply(ctx: Context): void {
  registerGate(ctx, { ...MY_GATE, check })
}
```

## 契约边界行为（注册表会替你兜底）

- `id` 非 kebab-case、重名或使用保留 id（如 `gates-config`）→ 注册即抛（fail loud）；
- `on`/`level` 用了词表外的值（如拼错 `'Blocking'`）→ 注册即抛——否则
  该 gate 会**静默**变成从不触发/从不阻断；
- 词表当前：`on ∈ {'stop','manual'}`，`level ∈ {'blocking','advisory','defer'}`；
- 运行时细节（超时、预算、反馈形状）见 [execution-model](execution-model.md)。

## rationale 与 remedy 的写法

- **rationale**：为什么存在这个检查 + 为什么手改是安全的（如"注册表
  从文件系统读时自动 reconcile，所以挪文件即完整修复"）。它是模型
  带着意图修复的依据，别省。
- **remedy**：能用模型现有工具（编辑/文件操作）完成 → `manual` +
  guidance；需要专用修复逻辑 → 另出 tool，remedy 用
  `{ kind: 'operation', operation: '<operation-id>' }` 指路（只许
  operation id，不许工具名）。

## 验证

1. 装了 gates 的 profile：`/gates` 聚合里能看到你的 gate；制造违规 →
   轮末拦截 → 修复 → 通过；
2. **软依赖验证**：卸载 gates（或换未装的 profile），你的插件照常启动，
   无 PENDING、无报错；
3. **回滚验证**（若有热重载环境）：插件重载后无 "already registered"。

## 实例

- `coggit-misplaced`（coggit 插件 `src/gates.ts`）：镜像对齐检查，数据面
  `listMisplacedCognition()`，remedy manual（registry reconcile-on-read 保证手挪无漂移）。
- `doc-link`（同包 markdown 模块）：**通用** Markdown 链接完整性 gate——
  数据面是 markdown 模块内 links 事务库，插件只持有政策（rationale / level /
  `relevantPath` / W10 归责谓词）。这是「仓库级 → 插件级」升格样板：检查本身项目无关，
  装一次、整个 profile 的所有工作区自动获得门禁（原每项目 `gates.yml` `module:` 薄
  shim 已归档；需要仓库级声明时可把 `module:` 指向本插件的 `./markdown/gate-check` 面）。
- `md-metadata`（同模块 `src/metadata-check.ts` + `src/index.ts`）：**defer + subagent
  fixer** 的插件级样板——会话被写 md 必须带非空 frontmatter `description`；检查是
  change-set 消费者（`changes` 为 null 直接放行），修复是语义判断故派子 agent 离线
  写。原仓库级数据面（开发仓库根 `gates.yml` 的 `module:` 条目）已撤，声明随定义
  一起进包。

完整 evidence 与验收预期见会议纪要 `case-2-coggit-misplaced`。
