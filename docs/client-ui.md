---
description: extras 模块 UI 开发指南——遇到 UI 需求的思考路径：先问通用工具卡够不够 → 不够才写 client 半边 → 半边挂嵌套锚点包（不是根 dsh.client）→ tab 形态是自由变量 → 何时连 UI 一起拆包
---

# 给 extras 模块加 Web UI 的思考路径

面向「下一个要给模块加 UI 的作者」。机制证据（宿主契约层）在
[explorer/client-ui-mount-paths](../../../explorer/client-ui-mount-paths/README.md)，
发布决策在 `workunits/plugin-publish/release-plan.md`，本文只讲**怎么想、怎么写**。

## 第一步：真的需要写 UI 吗？

按成本从低到高排查，前一条能覆盖就不往下走：

1. **通用工具卡回退**（零成本）：模块只暴露**工具**（如 md/routes），调用/结果
   事件自动被宿主 `dsh-client-ui-tool` 渲染成通用表单卡。工具面模块到此为止。
2. **settings 命名空间**（纯 server）：`ctx.settings.installSection()` 注册后用户可
   经配置文件编辑——**没有 GUI 卡**（宿主无通用配置卡渲染，见 explorer topic Q3
   证伪记录），只适合「有默认值、偶尔改」的配置。
3. **定制 client 半边**（本文其余部分）：需要 GUI 上的开关/列表/专有交互时才写。

## 第二步：写半边，挂锚点——不是根 `dsh.client`

宿主不变量：「一个声明 `dsh.client` 的包恰好一个 active Loader source」。extras
根有多个 server 行，若根声明 `dsh.client`，所有行都归属根 → 多 source →
`dsh web` 启动失败（事故全案见
`workunits/plugin-publish/20260901-extras-web-boot-client-source-conflict.md`）。

因此 client 面统一住在**嵌套锚点包** `modules/client/`（自有 manifest
`@catheadowl/dsh-extras-client`）：`nearestPackage` 把 `extras-client` 行归属到嵌套
manifest，合成 bundle 恰好是一个 source；extras 根保持 server-only。锚点机制与
验收记录见 [modules/client/README.md](../modules/client/README.md)。

给模块 `<m>` 加 UI 的操作序：

1. 半边写在 `modules/<m>/src/client/`（slot/locale/持久化归模块所有，遵循宿主
   cookbook `docs/cookbook/adding-a-settings-card.md` 的两半侧模式）；
2. 在锚点入口 `modules/client/src/client/index.ts` import 并追加一行
   `apply(ctx)`；
3. 半边需要的外部宿主 client 包并入锚点 manifest 的 `dsh.client.inject`；
4. `pnpm run build:client` 重建并重启 host。

## 第三步：tab 形态是自由变量，别在锚点层提前设计

tab 注册是 `settings.plugins.tab` root list slot 的一行贡献（gates 用 id `gates`
order 4，prompt 用 `prompt-middleware` order 6）。由此：

- **现在多 tab 并排**：每个模块自己注册自己的 tab，锚点只组合，不感知 tab 语义；
- **想合并成单一「Extras」tab**：改各半边注册（或加一个壳 tab + 子卡），锚点
  结构零改动；
- **某模块要独立拆包**：半边随模块源码一起迁走，锚点删一行 import。

即锚点解决的是「**source 归属**」问题，tab 呈现形态完全解耦——不要为了 tab 形态
去动锚点结构。

## 拆分出口

模块出现独立受众（第二个外部消费者）时按
`handbooks/dsh-deps/sibling-release-topology.md` 判定抽出单独成包；抽出时
server 行与 client 半边一起走，新包自有 `dsh.client` 声明（多 client 包共存是
宿主机制常态，见 explorer topic Q1）。
