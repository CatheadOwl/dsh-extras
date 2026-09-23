---
description: 插件以软依赖注册 gate 的配方——结构 *Like 镜像 + ctx.inject 条件注入 + 返回 disposer，零包依赖，含模板与契约边界行为
---

# 配方：插件注册自己的 gate（软依赖）

> 适用：检查逻辑属于**某个插件**（如一致性、镜像对齐、通用健康检查），应随插件安装/ 卸载自动生效/回滚。类比"把 gates 当软依赖开发的 native-like hook"：仍是普通插件间协作，不要求宿主内置 gate 包。仓库级检查（不依赖插件存亡）看 [adding-a-repo-gate](adding-a-repo-gate.md)。

## 三条纪律

1. **零包依赖 + 软服务依赖**：不 import gates 的包（连类型都不 import）——用本地结构 `*Like` 镜像 + `ctx.inject(['gates'], …)` 条件注入声明依赖；profile 未装 gates 时你的插件照常加载、只是不注册。**禁止**把 `gates` 写进插件自己的硬 `inject` 数组。这也是宿主生态的正字：宿主自己的插件间消费（包括 monorepo 内部）全部手写这一仪式，不存在「provider 发一个注册 helper 包给消费者 import」的形态。
2. **类型面用结构镜像**：`GateDefinition` / `GateViolation` 等契约以本地 `*Like` 接口镜像你读/写的字段子集——两个包各自独立编译、互不构成依赖边。镜像的契约漂移要自守：词表拼错在注册即抛（fail loud），漏镜像新字段则以「静默不生效」暴露，升级 gates 后重跑验证步骤兜底。
3. **inject 回调必须 return disposer**：`ctx.inject(['gates'], c => c.gates.register({...}))` 回调的返回值就是注册表 disposer，交还 Cordis fiber（fiber 卸载时自动清理；gates 注册表是纯 Map、无 effect 跟踪，disposer 是**唯一**回滚通道）。丢弃回调返回值 → 热重载重名报错、卸载后 gate 永久残留。

## 模板（照抄改三处）

```ts
import type { Context } from '@deepseek-ai/cordis'

// 1) 契约镜像：只镜像你的 gate 读/写的字段子集（结构类型，零 import）
export interface GateDefinitionLike {
  id: string
  description: string
  rationale: string
  on: Array<'stop' | 'manual'>
  level: 'blocking' | 'advisory' | 'defer'
  check(root: string): Promise<GateViolationLike[]>
}

export interface GateViolationLike {
  file?: string
  reason: string
  remedy?: { kind: 'manual'; guidance: string }
}

// 2) gate 定义：rationale 写清"为什么存在 + 为什么手改安全"
const MY_GATE: Omit<GateDefinitionLike, 'check'> = {
  id: 'my-plugin-consistency',
  description: '一句话，进列表与失败反馈标题',
  rationale: '设计说明（失败时才注入，平时零成本）……',
  on: ['stop', 'manual'],
  level: 'blocking',
}

// 3) check：只读检测；root 是会话工作区根（运行时事实）。
//    要消费 stop 档变更集（增量归责/短路）时，按需镜像 `GateChangeSet`
//    你读取的字段子集（形状见 gates 源码 src/types.ts 的声明）。
async function check(root: string): Promise<GateViolationLike[]> {
  return []
}

// 4) 在插件 apply 里注册：回调 return register 的 disposer（唯一回滚通道）
export function apply(ctx: Context): void {
  void ctx.inject(['gates'], (gatesCtx) => {
    return (gatesCtx as unknown as {
      gates: { register(definition: GateDefinitionLike): unknown }
    }).gates.register({ ...MY_GATE, check })
  })
}
```

## 契约边界行为（注册表会替你兜底）

- `id` 非 kebab-case、重名或使用保留 id（如 `gates-config`）→ 注册即抛（fail loud）；
- `on`/`level` 用了词表外的值（如拼错 `'Blocking'`）→ 注册即抛——否则该 gate 会**静默**变成从不触发/从不阻断；
- 词表当前：`on ∈ {'stop','manual'}`，`level ∈ {'blocking','advisory','defer'}`；
- 运行时细节（超时、预算、反馈形状）见 [execution-model](execution-model.md)。

## rationale 与 remedy 的写法

- **rationale**：为什么存在这个检查 + 为什么手改是安全的（如"注册表从文件系统读时自动 reconcile，所以挪文件即完整修复"）。它是模型带着意图修复的依据，别省。
- **remedy**：能用模型现有工具（编辑/文件操作）完成 → `manual` + guidance；需要专用修复逻辑 → 另出 tool，remedy 用 `{ kind: 'operation', operation: '<operation-id>' }` 指路（只许 operation id，不许工具名）。

## 验证

1. 装了 gates 的 profile：`/gates` 聚合里能看到你的 gate；制造违规 → 轮末拦截 → 修复 → 通过；
2. **软依赖验证**：卸载 gates（或换未装的 profile），你的插件照常启动，无 PENDING、无报错；
3. **回滚验证**（若有热重载环境）：插件重载后无 "already registered"。

## 实例

- `coggit-misplaced`（vscode-plugins 仓 coggit 插件的 dsh 适配）：**全套结构镜像**形态的生产样例——镜像 `GateDefinition` / `GateViolation` 子集 + `ctx.inject(['gates'])` 注册，注册落点其 `src/gates.ts`。
- `doc-link` / `md-metadata`（同包 markdown 模块）：**通用** Markdown 链接完整性 gate 与 **defer + subagent fixer** 样板。同包消费者以包内产物 type-only 引用取代镜像（零 import 纪律的论证范围是树外的 build-order 与 peer 解析），注册仪式与树外完全同形。`doc-link` 检查项目无关，装一次、整个 profile 的所有工作区自动获得门禁；需要仓库级声明时可把 `module:` 指向 `./markdown/gate-check` 面（数据面与归责策略见 [execution-model](execution-model.md) 的归责过滤节）。
