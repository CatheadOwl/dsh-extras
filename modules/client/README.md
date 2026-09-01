---
description: extras 的 client 合成模块——把各模块的 client 半（gates/prompt 的 Settings Tab）组合进单一浏览器 bundle；一个包一条 web 插件行，故只有一个 client 面
---

# client 合成模块

`@catheadowl/dsh-extras` 在 web 插件表里是**一行**（一个包 id），因此整包只有一个
client bundle：本目录把每个模块的 client 半组合进一个工厂。各半的 slot/locale 注册
归各模块所有（`modules/<m>/src/client/`），此处只做组合。

- 入口：`src/client/index.ts`（组合 apply/inject，import 各模块 client 半）
- 构建：`tsdown`（client 预设，cwd=本目录）→ `lib/client.js`；包 manifest 的
  `exports['./client']` 指向这里，`dsh.client.inject` 为各模块需求并集
- `src/index.ts` 是占位 node 半（从不作为插件装载），仅为共享 tsdown 预设的
  libEntry 存在；类型检查走 `tsconfig.check.json`（含各模块 client 源）

新增带 UI 的模块时：在其 `src/client/` 写半边，然后在本入口 import 并追加一行
`apply`，同时把新增的外部依赖并进包根 `dsh.client.inject`。
