---
description: gates 插件的使用文档入口（cookbook 风格阅读地图）：执行模型与「加仓库 gate / 加插件 gate / 按确定性分档」三个配方，及与门面契约、决策史、宿主先例的关系
---

# gates 插件文档

`@catheadowl/dsh-extras` 的使用文档（cookbook 风格，参照宿主 `deepseek-harness/docs/cookbook/` 的配方式组织）。

## 阅读地图

| 文档 | 内容 |
|------|------|
| [why-gates](why-gates.md) | 为什么需要 gates：宿主 turn-stopping 的机制事实与 gates 的注册面/公共机制/契约层价值 |
| [execution-model](execution-model.md) | 触发时机与执行链、级别与预算、反馈形状、成本模型 |
| [register](register.md) | 插件消费面：`@catheadowl/dsh-extras/gates/register`、最小 quickstart、公共 API reference |
| [adding-a-repo-gate](adding-a-repo-gate.md) | 配方: 给仓库加一个 Config 声明式 gate（module / command 两形态） |
| [adding-a-plugin-gate](adding-a-plugin-gate.md) | 配方: 插件以软依赖方式注册自己的 gate（条件注入 + 结构类型模板） |
| [designing-gate-sets](designing-gate-sets.md) | 配方: 一个逻辑检查拆成多个 gate，按确定性分档（自动修 / 阻断 / 报告） |
| [development](development.md) | 维护指南：消费面变更、构建与测试、自举 gates、兼容纪律 |

> 嫌翻文档麻烦？装了本插件后，在 dsh 会话里打 `/gates-config-guide` 会把「创建 / 理解 / 编写 `gates.yml`」的操作指南作为 skill 注入（仅用户显式调用，模型不自动加载）。skill 正文维护在 `src/skills.ts`，本文档是它的权威展开。

## 与其他文档的关系

- **门面与契约**：[../README.md](../README.md)——提供面、契约要点、架构两种形态、安装与验证；本目录是它的展开。
- **决策推演与证据链（SSOT）**：`docs/meeting-room/20260822-1436-local-ci-gates/`（plan-1 为决策记录，两个 case 文件含 evidence 与验收预期）。
- **宿主先例**：轮末阻断对应宿主两个桥（`packages/hooks/hooks-claude-code/` 与 `hooks-codex/`）的 Stop 实现；结果契约形状继承宿主 `scripts/run-gates.ts`。

## 状态声明

**本插件处于开发期，契约随时可能变化**（尤其：触发档位、remedy 的 operation 面；`gates.yml` 方言为暂行定义，上游若出原生方言则对齐；增量短路已落地，其边界见 execution-model）。引用本目录内容前请核对 [../README.md](../README.md) 的“已知限制 / 后续”节。
