---
description: 开发工作流——构建/测试命令、宿主 checkout 摆放约定、工具链借用与 peer junction 接线、host-closure 网络检查的代理与跳过
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

## 宿主 checkout 摆放约定

构建脚本（`package.json` 的 `build:*` / `check-types:*`）以 `..\..\deepseek-harness` 锚点借用宿主工具链（`node_modules/.bin` 下的 tsc / tsdown）。因此克隆本仓库后，先在**同级目录**摆一份 deepseek-harness 检出并构建（`pnpm install && pnpm run build`）：

```text
<parent>/
  deepseek-harness/     # dsh host checkout (built)
  <this-repo>/          # this package repository
```

开发期宿主 peer 的解析 = 把 `node_modules/@deepseek-ai/*` 按 junction 接到宿主检出的 **workspace 源目录**（与宿主 CLI 安装顶层 node_modules 内链接同形态）。

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

## host-closure 网络检查

`verify:publish-readiness` 的 host-closure 检查走 npm registry 网络（每请求 10s 超时）；网络不稳时用 Node 内建代理支持：`$env:NODE_USE_ENV_PROXY='1'; $env:HTTPS_PROXY='http://<proxy>'`（Node ≥ 24）。离线构建可设 `DSH_SKIP_HOST_CLOSURE=1` 跳过该检查（红检查永不静默转绿）。
