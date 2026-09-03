---
description: extras 的 client 锚点包——嵌套 manifest（自有 package.json/dsh.client/./client export）使合成 client bundle 成为恰好一个 Loader source；gates/prompt 的 Settings Tab 组合进单一浏览器 bundle，extras 根保持 server-only
---

# client 锚点包（嵌套 manifest）

本模块是 extras 的 client 锚点包：把 gates/prompt 各模块的 Settings Tab 组合成
单一浏览器 bundle，并通过自有嵌套 manifest 使这个合成 bundle 成为恰好一个
Loader source。包内角色：extras 根保持 server-only（不声明 `dsh.client`），
全部 client 面集中在本目录。

该归属机制曾引发 boot 冲突，设计动机见下。

## 随包契约清单

嵌套 `modules/client/package.json` 是随 extras tarball 发布的唯一 client 声明面：

- `name`：`@catheadowl/dsh-extras-client`（非空，宿主按最近 manifest 归属 client
  行的键）；
- `version`：非空——空 `name`/`version` 即归属失败（宿主契约）；
- `private`：`true`，不单独发布，随 extras tarball 走；
- `exports['./client']`：`./lib/client.js`，合成 bundle 的装载入口；
- `dsh.client.inject`：浏览器侧外部依赖清单（dsh 官方 UI 组件），由宿主在
  装载时注入。

设计与扩展指南见 [docs/development.md](docs/development.md)。
