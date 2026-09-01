---
description: dsh-extras 单包多行发布载体——一个 npm 包装多个独立插件模块（gates 已迁入，md/prompt/routes/subagent 迁入中）；模块=组合行=独立 fiber，./register 保留 gates API 面
---

# @catheadowl/dsh-extras

单一 npm 包承载多个**运行时独立**的 dsh 插件模块。设计依据、实验证据与迁移 SOP 见
`workunits/plugin-publish/release-plan.md`（开发仓库纯文本引用，不随包发布解析）。

## 形态（单包多行）

- `cordis.patch.yml` 用 `- insert:` 声明每个模块一行，行 `name` 是锚定在本包目录的
  相对子路径（`./modules/<m>/lib/index.js`）；
- 每行独立 fiber、独立 Config——用户在 profile patch 层对某行 `id` 写
  `disabled: true` 即单关一个模块；
- 安装 = `dsh plugin add @catheadowl/dsh-extras` 一次全装；
- 模块下架 = 包版本更新（删行删子路径，`plugin update` 收缩）。

## 模块

| 模块 | 内容 | 状态 |
|---|---|---|
| `modules/gates` | 原 `@catheadowl/dsh-gates`（ctx.gates 质量门禁） | 已迁入 |
| `modules/md` | 原 md-links + md-rename + md-links-gates（`md_rename` 工具 + `doc-link` gate + 内置链接事务库） | 已迁入 |
| `modules/prompt` | 原 prompt-middleware + prompt-parse + workspace-tree（prompt 注入服务 + 内置 parse/tree 库） | 已迁入 |
| `modules/routes` | 原 any_routes（通用 Markdown 路由视图工具 any_routes + breadcrumb relates provider） | 已迁入 |
| `modules/subagent` | 原 subagent-at（`subagent_at` 工具 + `dsh-sdk-at` provider；行 id `subagent-at`——宿主 dsh-base 已占用 `subagent`） | 已迁入* |

各模块的架构、契约、测试与使用文档在各自目录（`modules/<m>/README.md` 等，
随源码从原包整体迁入）。

## API 面

- `@catheadowl/dsh-extras/register`——gates 的插件消费面（`registerGate` +
  `GateDefinition`/`GateViolation` 类型），保持原 `@catheadowl/dsh-gates/register`
  的导出集合不变（coggit 等消费方只改包名）；
- `@catheadowl/dsh-extras/gate-check`——md 模块 gates.yml 回退面。
- Web 客户端面：`modules/client` 嵌套锚点包（`@catheadowl/dsh-extras-client`，自带
  package.json + `dsh.client` + `./client` export，不单独发布）——gates/prompt 的
  Settings Tab 经此合成 bundle 装载；`nearestPackage` 把 client 行归属到嵌套 manifest，
  extras 根保持 server-only，绕开 client-modules「一包一源」冲突（独立 DSH_HOME
  web 终态 boot 验收通过，见 `workunits/plugin-publish/release-plan.md` §目标态）。

## 构建与验证（开发态）`r`n`r`n> *subagent 模块源码重建被上游缝缺口挂起（SDK client 收走任意子运行时启动面,见`r`n> `docs/upstream-issues/20260901-1642-sdk-client-no-arbitrary-runtime-launch/`）,沿用缝前构建的 lib;`r`n> 其余四模块 tsc 重建正常。

```powershell
# 从本目录（dsh-plugin-dev/extras）
pnpm run build:gates            # tsc：模块 lib/ + types
pnpm run build:gates:client     # tsdown：Web client bundle → modules/gates/lib/client.js
pnpm run test:gates             # 模块单元测试

# 装进 profile（裸路径 = link 语义）
dsh plugin --profile headless add D:/Document/Projects/dsh/dsh-plugin-dev/extras
```

peer 解析（Windows junction）与测试前置同原各包：`extras/node_modules/` 的
junction 层覆盖运行时 peer，随模块迁入逐步并集。
