---
description: 为什么需要 prompt 模块——宿主 agent/pre-step 检查点的机制事实与框架的注册面/共存纪律价值；含失效判据与边界
---

# 为什么需要 prompt 模块（why）

## 宿主检查点的机制事实

dsh 宿主在 user prompt 进入模型前提供 `agent/pre-step` 检查点（waterfall 模式，监听者可改写/拒绝 claimed messages），事实是：

- **人人可挂，但各挂各的**：任何插件都能直接监听 pre-step 自己注入上下文——单插件、单需求、不在意重复注入时完全够用；
- **宿主没有「多注入者共存」的原语**：第二个注入者出现时的合并与定序、跨 compact 的去重、注入预算的分配、用户按来源关闭某个注入——这些宿主都不管，散写的注入者要么互相不知情地抢占上下文，要么各自重造管线；
- **模型可见性是宿主不变量**：注入内容进 session log 才对模型可见——散写注入者要自己发现并遵守这条纪律。

## 本模块提供什么

prompt 模块把 pre-step 上的 prompt enrichment 收束成一个 provider 注册表（`ctx.promptMiddleware` + `registerRelatesProvider` 消费面）：

1. **注册面**：插件只写单 path 的 `resolve` + 稳定 `kind`，框架物化为完整 provider——第二个注入者的接入成本比手写低一个量级；
2. **共存纪律**（不只是触发包装）：once ledger 按 `(sessionId, provider, key)` 记账、只记实际渲染幸存者、surface replace（compact 等）清账；渲染预算与记账脱钩（被截断的条目下轮重算）；多 provider 命中同一路径的合并与定序；失败降级不阻断轮次；
3. **可见性纪律**：注入统一渲染为不改写用户消息的附加上下文，信封不署插件名。

## 什么不是它的价值

- **路径解析**：内嵌 parse/tree 是独立纯库，本模块只是其消费者；
- **注入内容的价值**：面包屑、认知链接有没有用是各 provider 领域的命题；本模块的价值是让这些注入**可共存、可记账、可关闭**；
- **hook 位置**：pre-step 人人可挂，占住接缝不构成价值。

## 失效判据

如果业务 provider 退回手写直挂、没有第三个注入者出现、或框架开始吸收领域逻辑（把「某类上下文怎么生成」写进承载层）——说明这层抽象价值不足，应收敛为单 provider 工具。

深入：注入契约（once 记账 / 声明式 subjectOf / 定序 / 开关）见 [contract](contract.md)；注册面 API 见 [register](register.md)。
