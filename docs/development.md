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

## host-closure 网络检查

`verify:publish-readiness` 的 host-closure 检查走 npm registry 网络（每请求 10s 超时）；网络不稳时用 Node 内建代理支持：`$env:NODE_USE_ENV_PROXY='1'; $env:HTTPS_PROXY='http://<proxy>'`（Node ≥ 24）。离线构建可设 `DSH_SKIP_HOST_CLOSURE=1` 跳过该检查（红检查永不静默转绿）。
