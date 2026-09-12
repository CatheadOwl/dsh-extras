---
description: 开发工作流——构建/测试命令、宿主 checkout 锚点（构建硬锚点 + 接线工具 DSH_REPO 覆盖）、工具链借用与 peer junction 接线、host-closure 网络检查的代理与跳过
---

# 开发工作流（development）

## 命令

```powershell
# From the repository root
pnpm run build                  # four module libs + client bundle
pnpm run test:gates             # per-module unit tests (test:markdown / test:prompt / test:routes)
pnpm run verify:package-face    # exports / facade checks
pnpm run verify:publish-readiness  # release hygiene checks (docs locality, host closure, ...)
```

## 宿主 checkout 锚点

工具链分两类：**tsc 自持**（本包 devDependency 安装，`build:*` / `check-types:*` 直接调用，与宿主检出位置无关）；**tsdown 借宿主**（[scripts/host-tool.mjs](../scripts/host-tool.mjs) 锚点解析，因为它必须与宿主源码树里的 `clientBundle` preset 配对，preset 无 npm 出口）。锚点解析链：`DSH_REPO`（机器级 env）> 嵌套仓默认 `../../deepseek-harness`（零配置形态仍是同级摆放）：

```text
<parent>/
  deepseek-harness/     # dsh host checkout (built)
  <this-repo>/          # this package repository
```

宿主检出不在默认位置时设 `DSH_REPO` 即可。构建前置（一次性）：

1. 宿主检出 `pnpm install && pnpm run build`（tsdown 借用 + preset 需要）；
2. 本包 `pnpm install`；
3. 本包根执行 `node scripts/relink-host-peers.mjs`（锚点链同上）——把 `node_modules/@deepseek-ai/*` 按 junction 接到宿主检出的 **workspace 源目录**（与宿主 CLI 安装顶层 node_modules 内链接同形态）。**`@deepseek-ai/*` 类型解析依赖这层 junction**（各 `tsconfig*.json` 不含宿主路径），缺了它 check-types/build 必红（fail-loud，不是可选项）。

各模块的行为 eval（意图/回归用例）位于 `modules/<m>/eval/`；框架与运行方式见各模块 eval README（不随包发布，名称引用）。

## tsdown 树外补丁（client 构建前置）

`build:client` 调用宿主共享 preset `clientBundle`，而宿主的 `workspaceManifest` 按宿主包布局（`packages/*/*/package.json`）查清单，树外插件**查不到是结构必然**（上游缺陷档案 tsdown-out-of-tree-manifest，按名引用）。不打补丁则 `build:client` 必败，症状：

```text
ERROR Error: tsdown: no packages/*/*/package.json declares the name @catheadowl/dsh-extras
```

补丁文件：[patch/tsdown-out-of-tree-fallback.patch](../patch/tsdown-out-of-tree-fallback.patch)——在 `workspaceManifest` 的 glob 未命中后回退 `outOfTreeManifest`（从构建 cwd 向上找最近的、`name` 匹配的 `package.json`；树内行为零变化）。每次更新宿主检出后重放：

```powershell
git -C <host-checkout> apply patch/tsdown-out-of-tree-fallback.patch
```

**作用域**：只作用于本仓库的 `build:client` 编译期，不进产物、不构成消费者的任何前置条件（tarball 只带 `lib/` 产物，运行时 Loader 只 import 产物）。

**退役条件**：上游 `packages/client/tsdown.client.ts` 的 manifest 查找支持树外包（不打补丁 `build:client` 直接成功）即可删除补丁与本节。

## client 测试工件补丁（树外组件测试）

上游只产浏览器运行时 bundle（`lib/client.js` 是 `window.__ModuleLoader__` closure factory），树外插件没有可 Node import 的可测工件（上游缺陷档案 out-of-tree-client-component-testing，按名引用）。补丁文件：[patch/client-test-bundle.patch](../patch/client-test-bundle.patch)——在 `clientBundle` 里按 `DSH_CLIENT_TEST_BUNDLE=1` 追加一个 ESM/node 工件面（同入口、同 externals、同 CSS virtual loader，无 closure 包装），产出 `modules/client/lib/client.test.js`。与上一节 manifest 补丁同文件不同区域，同一重放流程（更新宿主检出后 `git apply` 两个补丁，顺序任意但须都在）：

```powershell
git -C <host-checkout> apply patch/tsdown-out-of-tree-fallback.patch
git -C <host-checkout> apply patch/client-test-bundle.patch
```

用法：`$env:DSH_CLIENT_TEST_BUNDLE='1'; pnpm run build:client`（同时出 `lib/client.js` 与 `lib/client.test.js`；不设该变量时树内/树外行为零变化）。组件 spec 面向 `client.test.js`：`react` 从 devDependencies 真解析，module-table peer（`@deepseek-ai/dsh-client-ui-primitives` 等）由 spec mock（vitest `vi.mock` 等价物）；样式注入模块有 `typeof document` 守卫，jsdom 下注入、纯 Node 下跳过。已验证：stub 掉 peer 后纯 Node `import` 成功，导出 `apply`/`inject`。

**作用域**：测试工件只在本地构建期生成，`files` 不含 `client.test.js`，不随 tarball 发布；消费者无感知。**退役条件**：上游提供树外 client 组件测试入口或 Node-importable 工件后删除补丁与本节。

## host-closure 网络检查

`verify:publish-readiness` 的 host-closure 检查走 npm registry 网络（每请求 10s 超时）；网络不稳时用 Node 内建代理支持：`$env:NODE_USE_ENV_PROXY='1'; $env:HTTPS_PROXY='http://<proxy>'`（Node ≥ 24）。离线构建可设 `DSH_SKIP_HOST_CLOSURE=1` 跳过该检查（红检查永不静默转绿）。
