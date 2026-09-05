---
description: 为什么需要 gates——宿主 turn-stopping 检查点的机制事实（serial、桥无注册面、宿主 TODO 方向）与 gates 在其上的契约层价值；含失效判据与演进姿态
---

# 为什么需要 gates（why）

## 宿主检查点的机制事实

dsh 宿主在 turn 收尾提供 `agent/turn-stopping` 检查点，事实是：

- **serial 模式**：宿主 await 全体监听器，多监听器共存、监听顺序无关——「抢占/踩踏」不是问题；
- **配置钩子桥没有插件注册面**：宿主的 hooks 子系统（hooks-claude-code / hooks-codex）只翻译配置文件里的外部命令；插件自带的检查没有可挂的声明入口（宿主自述「a native cordis plugin could do everything this bridge does — more powerfully」，但没给注册面）；
- **反对协议与预算要自己做**：裸挂监听器的检查要自己处理 steer 反对、连续阻断自限与项目级配置发现——后两者宿主源码里只有 TODO 标记（stop-loop-guard / per-session-hook-config），无实现无提案。

## gates 提供什么

gates 把这个检查点包装成可组合的 gate 框架（`ctx.gates` + `registerGate` 消费面）：

1. **注册面**：插件自带检查与仓库级 `gates.yml` 声明进入同一执行面——插件级检查的唯一声明入口；
2. **公共机制**：统一调度执行、steer 反对协议、连续阻断预算（耗尽降级放行）、项目级配置发现；
3. **契约层**（不只是触发包装）：enforcement 三档（blocking / advisory / defer）、fixer 修复环、归责过滤（只 steer 与本会话变更相关的失败）、会话变更集消费（脏变更驱动的增量扫描）、类型化结果（description / rationale / violation / remedy）聚合为一次 turn 收尾把关。

## 失效判据

如果新 gate 大多绕开 `ctx.gates` 直接监听事件、各插件仍重复实现预算与反馈、或只剩单点检查没有插件级注册需求——说明这层抽象价值不足，应主动收敛（完整判据见开发侧 gate 抽象边界 spec，按名引用）。

## 演进姿态

宿主若原生落地同类注册表，本模块按行 id 独立退场；在上游落地前，`gates.yml` 方言保持最小声明式、与宿主 TODO 声明的语义同形，收敛成本最低。

深入：执行链与预算见 [execution-model](execution-model.md)；注册面 API 见 [register](register.md)。
