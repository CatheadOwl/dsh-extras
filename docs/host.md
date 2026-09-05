---
description: 与宿主的关系——peer 闭包与组合行形态、为什么包装宿主 hook、本包的 opinionated 取向（「做 harness 就是做 docs」的 curated 兑现）
---

# 与宿主的关系（host）

## 关系事实

- 运行时依赖全部由 dsh 宿主提供：本包声明为 peerDependencies，`dsh plugin add` 时随宿主闭包解析；包自身只带少量纯 JS 工具依赖。
- 挂载形态：每个模块是宿主插件组合里的一行（row，按行 id 标识），不共享状态，关掉任何一行其余行为不变。

## 为什么包装宿主的 hook

宿主在 turn 收尾提供 `agent/turn-stopping` 检查点（serial 模式，多监听器共存、顺序无关）——但检查点只提供「反对即 steer」的原语：配置钩子桥没有插件注册面，裸挂监听器的每个检查都得各自实现反对协议、阻断自限与配置发现。gates 把它包装成可组合的 gate 框架（`ctx.gates` + `registerGate` 消费面），价值不止触发包装，而在其上的契约层（enforcement 三档、fixer、归责过滤、预算）。完整论证见 [modules/gates/docs/why-gates.md](../modules/gates/docs/why-gates.md)。

## 本包的 opinionated 取向

宿主是中性的组合基础设施，不预设立场；本包是建在其上的一套 harness 倾向——「做 harness 就是做 docs」这条 slogan 的 curated 兑现。各模块不是在补宿主的能力缺口，而是各自表达一个立场：

- **gates**：turn 收尾的把关不该靠各插件裸抢 hook，而应是一个声明式注册、统一调度的 gate 组合面；
- **markdown**：内链卫生不该靠人肉维护——搬移即改写（`md_rename`），turn 收尾自动把关（`doc-link` gate）；
- **prompt**：项目知识的注入是声明式的——provider 声明 → 预算渲染 → 会话注入，不手写 prompt；
- **routes**：大 docs 树先路由后深读——`any_routes` 路由视图 + breadcrumb relates 让知识库以结构可导航。
