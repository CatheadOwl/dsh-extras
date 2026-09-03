# client 锚点包开发指南

面向包仓库贡献者；路径均相对包根（extras 仓库根，即本包 `package.json` 所在目录）。

## 设计动机：为什么需要嵌套 manifest

宿主 client-modules 的不变量是「一个声明 `dsh.client` 的包恰好一个 active Loader source」。宿主按最近 manifest（`nearestPackage`）把每个 client 行归属到一个包；若 extras 根在声明五个 server 行的同时又声明 `dsh.client`，五行会全部归属到根 manifest → 五个 source → 组合错误。该机制曾引发 boot 冲突（事故记录见原设计记录，纯文本引用）。

解法：`modules/client/` 持有自己的嵌套 package.json：

- 根 patch 的 `extras-client` 行（`./modules/client/lib/index.js`）经 `nearestPackage` 归属到嵌套 manifest → 表里以嵌套包名为键的独立一行；
- 五个 server 行归属 extras 根（无 `dsh.client`）→ 完全绕开 client registry；
- 一个嵌套包 = 恰好一个 client source，与宿主「多 client 包共存」的机制常态同构。

嵌套 manifest 必须声明非空 `name` 与 `version`——空值即最近 manifest 归属失败（宿主契约；扩展讨论见原 TODO 记录，纯文本引用）。

## 实现布局（仓库内路径）

- 入口：`modules/client/src/client/index.ts`（组合 apply/inject，import 各模块 client 半）；
- 构建：`tsc`（占位 node 半 → `lib/index.js`）+ `tsdown`（client 预设，cwd=本目录）→ `lib/client.js`；嵌套 manifest 的 `exports['./client']` 指向这里；
- `modules/client/src/index.ts` 是占位 node 半（从不作为插件装载，无副作用），只为行的文件归属与共享 tsdown 预设的 libEntry 存在；
- 类型检查走 `modules/client/tsconfig.check.json`（含各模块 client 源）。

## 扩展指南：新增带 UI 的模块

在其 `src/client/` 写半边，然后在 `modules/client/src/client/index.ts` 入口 import 并追加一行 `apply`，同时把新增的外部依赖并进嵌套 manifest 的 `dsh.client.inject`。
