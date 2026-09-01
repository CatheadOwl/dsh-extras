---
description: 配方：一个逻辑检查拆成多个 gate——按修复确定性分档（自动修 / 阻断 / 报告）；level 与 fixer 是 gate 级属性，不是 violation 级
---

# 配方：一个逻辑检查拆成多个 gate（按确定性分档）

> 适用：一个检查里，不同违规的「能不能自动修」不一样——有的能机械、幂等、
> 目标保持地修，有的必须语义决策。这时**不要**把整块逻辑写成一个 gate 再在内部
> 给每条违规分档；拆成多个 gate，各自带独立的 `level` + `fixer`。
>
> 前置阅读：[adding-a-repo-gate](adding-a-repo-gate.md) /
> [adding-a-plugin-gate](adding-a-plugin-gate.md)（单 gate 配方）、
> [execution-model](execution-model.md)（级别语义与反馈形状）。

## 为什么拆：level / fixer 是 gate 级，不是 violation 级

一个 `GateDefinition` 只有一个 `level`（`blocking` / `advisory` / `defer`）和一个可选
`fixer`；`check` 返回的每条 `GateViolation` 只能逐条分 `remedy`（修复指引），**不能逐条分档**。

所以「这类违规阻断、那类违规自动修」只能通过注册成**两个 gate** 实现，不能在单 gate
里按违规类型分叉 `level`。判断"该不该拆"的标准是**修复确定性**（有没有可确定的修复内核），
不是"报错文案不同就该拆"。

## 分诊原则：失败不是报警，是分流

一个 gate 失败时，第一刀按**修复确定性**分流：

- **能确定修** —— 能机械、幂等、目标保持地修，且 check 与修复**共享同一内核**。
  → 自动修，别让模型知道（零打扰）。
- **不能确定修 + 必须当场** —— 修法需要语义决策（新建目标 / 移动文件 / 改引用）。
  → 阻断，让模型当场决策（强打扰，配预算上限）。
- **不能确定修 + 不必当场** —— 只需记录、可稍后处理。
  → 留痕报告。

「能确定修」的安全来自**构造**：幂等 + target-preserving + property 测试，不靠模型判断。
语义决策型必须阻断——别用 fork 子 agent 冒充「可确定修」：子 agent 本身就是语义决策者，
只是把判断从有当前轮上下文的主 agent 换到只继承已完成轮次的子 agent，性质没变、上下文更差。

## 分档规则

| 档 | 判据 | 去向 |
|---|---|---|
| 自动修 | 能确定修（check 与修复同内核） | `defer` + `fixer`（`command` 机械 / `subagent` 语义但可 defer） |
| 阻断 | 不能确定修 + 必须当场 | `blocking`（steer 续步，主 agent 决策） |
| 报告 | 不能确定修 + 不必当场；或「想知道但不拦」 | `advisory`（只报告）/ `defer` 无 fixer（留痕快照） |

## 写法（两个注册面）

### 插件面：多次 `registerGate`

一个插件调多次 `registerGate`（或多次 `ctx.inject(['gates'], …)`），每个 gate 独立：

```ts
import { registerGate } from '@catheadowl/dsh-extras/register'

// 可确定修 → defer + fixer
registerGate(ctx, { ...AUTO_FIX_GATE, level: 'defer', fixer: { kind: 'command', command: 'node scripts/normalize.mjs' }, check })

// 语义决策 → blocking（无 fixer）
registerGate(ctx, { ...SEMANTIC_GATE, level: 'blocking', check })
```

### 仓库面：`gates.yml` 多个条目

```yaml
gates:
  - id: md-metadata      # 语义但可 defer → defer + subagent fixer
    module: scripts/md-metadata-lib.mjs
    level: defer
    fixer: { kind: subagent, prompt: "..." }
  - id: link-integrity   # 语义决策 → blocking（示意 id；真实 doc-link 已走插件级注册，见 md-links-gates）
    module: scripts/link-check.mjs
    level: blocking
```

## 实例：一个断链检查的「可拆」与「不可拆」

假设有一个链接完整性检查，违规分两类：目标不存在（`target does not exist`）与锚点缺失。

- **目标不存在**：修法是语义决策（新建目标 / 移动文件 / 改引用），无确定性解 → **整体 L2 阻断**。
- **锚点缺失**：同样需要判断"该建锚点还是改引用"，也无法机械解 → 也留阻断。
- **将来若发现可确定修的子类**（例：目标被重命名、只剩「改路径」一种正确解），把它拆成独立
  gate 走自动修，其余仍阻断：
  - `link-target`：`blocking`（目标不存在 / 文件名不可表示）
  - `link-renamed`：`defer` + `fixer`（可确定性改路径的子类）
- **拆的标准**：check 能否为这个子类提供确定性修复内核；不是「remedy 文案不同」就该拆。

> 上例是模式演示，不是某个具体插件的当前实现。

## 约束与坑

- `fixer` 只限 `defer` 档；非 `defer` 声明 `fixer` 会注册即抛。
- **机制约束**：fixer 无冷却无降级 → 「修不了」的违规若留在 `defer`，会每轮白烧一个子 agent
  且模型永远不可见；这类必须拆进 `blocking`。
- `level` 词汇表在插件加载时定死：新增/改档需重启 host（`gates.yml` 本身按 mtime 热读不受此限）。
- 自动修的 off-turn 改写无模型复核，安全由幂等 + target-preserving + property 测试兜底；若改写
  可能引入新违规，需要一扇阻断门兜底闭环（例如：样式归一化可能改出断链，就由链接完整性门再拦一道）。
