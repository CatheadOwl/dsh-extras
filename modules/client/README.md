---
description: extras 的 client 锚点包——嵌套 manifest（自有 package.json/dsh.client/./client export）使合成 client bundle 成为恰好一个 Loader source；gates/prompt 的 Settings Tab 组合进单一浏览器 bundle，extras 根保持 server-only
---

# client 锚点包（嵌套 manifest）

宿主 client-modules 的不变量是「一个声明 `dsh.client` 的包恰好一个 active Loader
source」。extras 根若有五行 server 行又声明 `dsh.client`，五行全部经
`nearestPackage` 归属到根 manifest → 五个 source → 组合错误（事故全案见
`handbooks/Gremlins/20260901-2312-dsh-client-source-attribution/incident-web-boot-conflict.md`）。

解法：本目录持有**自己的嵌套 package.json**（`@catheadowl/dsh-extras-client`，
`private`、不单独发布，随 extras tarball 走）：

- 根 patch 的 `extras-client` 行（`./modules/client/lib/index.js`）经
  `nearestPackage` 归属到嵌套 manifest → 表里以嵌套包名为键的**独立一行**；
- 五个 server 行归属 extras 根（无 `dsh.client`）→ 完全绕开 client registry；
- 一个嵌套包 = 恰好一个 client source，与宿主「多 client 包共存」的机制常态
  （web-app 自挂 ~25 个 client 包）同构。

- 入口：`src/client/index.ts`（组合 apply/inject，import 各模块 client 半）
- 构建：`tsc`（占位 node 半 → `lib/index.js`）+ `tsdown`（client 预设，
  cwd=本目录）→ `lib/client.js`；嵌套 manifest 的 `exports['./client']` 指向这里
- `src/index.ts` 是占位 node 半（从不作为插件装载，无副作用），只为行的
  文件归属与共享 tsdown 预设的 libEntry 存在
- 类型检查走 `tsconfig.check.json`（含各模块 client 源）

新增带 UI 的模块时：在其 `src/client/` 写半边，然后在本入口 import 并追加一行
`apply`，同时把新增的外部依赖并进嵌套 manifest 的 `dsh.client.inject`。

验收记录（2026-09 独立 DSH_HOME web profile 终态 boot）：boot 绿，boot graph 含
`@catheadowl/dsh-extras-client` 行，bundle 200（含 Gates Tab + Prompt Middleware
Tab 的 slot 注册/双语 locale/localStorage 镜像）。
