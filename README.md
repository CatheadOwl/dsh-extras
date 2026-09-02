---
description: dsh-extras 发布包 README——一个 npm 包装多个运行时独立的 dsh 插件模块（gates/markdown/prompt/routes 首发四行），安装、模块、配置、API 面与开发指南
---

# @catheadowl/dsh-extras

一个 npm 包，多个**运行时独立**的 [dsh](https://github.com/deepseek-ai/deepseek-harness) 插件模块：
质量门禁、Markdown 链接治理、prompt 注入、知识库路由——`dsh plugin add` 一次全装，
每个模块独立开关，不需要的行关掉即可，互不影响。

## 安装

```powershell
dsh plugin add @catheadowl/dsh-extras
```

要求：已安装 dsh CLI。所有运行时依赖由 dsh 宿主提供（peerDependencies，
`plugin add` 时随宿主解析），本包自身只带少量纯 JS 工具依赖。

## 模块

| 模块 | 行 id | 提供什么 | 文档 |
|---|---|---|---|
| gates | `gates` | 质量门禁框架（`ctx.gates`）：turn 收尾自动运行的可组合 gate 与 `registerGate` 消费面 | [modules/gates/README.md](modules/gates/README.md) |
| markdown | `markdown` | `md_rename` 工具（搬移并改写 Markdown 内链）+ `doc-link` gate + 内置链接事务库 | [modules/markdown/README.md](modules/markdown/README.md) |
| prompt | `prompt` | prompt 注入服务（declarative provider + 内置 parse/tree 库），向会话注入项目知识 | [modules/prompt/README.md](modules/prompt/README.md) |
| routes | `routes` | `any_routes` 工具（Markdown 知识库路由视图）+ breadcrumb relates provider | [modules/routes/README.md](modules/routes/README.md) |
| subagent | `subagent-at` | `subagent_at` 工具（带血缘的子代理定向派发，per-call `cwd`）+ `dsh-sdk-at` provider（行 id 避让宿主 `subagent`） | [modules/subagent/README.md](modules/subagent/README.md) |

每个模块是 cordis 组合里的独立一行（fiber）：不共享状态，关掉任何一行，
其余模块行为不变。

## 配置

在你的 profile patch 层按行 id 单关一个模块：

```yaml
- id: gates
  disabled: true
```

带默认配置的模块可覆写（键见各模块文档）：

```yaml
- id: prompt
  config:
    providerTimeoutMs: 2000
    totalTimeoutMs: 5000
    renderBudgetChars: 4000
```

模块上下架走包版本更新：升级本包后 `dsh plugin update` 收缩/扩展组合行。

## API 面

除组合行外，本包还导出两个稳定子路径（供其他插件消费）：

- `@catheadowl/dsh-extras/gates/register`——gates 插件消费面（`registerGate` +
  `GateDefinition` / `GateViolation` 类型）；
- `@catheadowl/dsh-extras/markdown/gate-check`——markdown 模块 gates.yml 回退面。

Web Settings Tab（gates / prompt）由包内嵌套锚点包
`@catheadowl/dsh-extras-client` 合成装载，不需要单独安装。

## 开发

```powershell
# 从本目录（extras 包根）
pnpm run build                  # 四模块 lib + client bundle
pnpm run test:gates             # 各模块单测（test:markdown / test:prompt / test:routes）
pnpm run verify:package-face    # exports / facade 校验
pnpm run verify:publish-readiness  # 发布卫生校验（docs locality 等）
```

构建借用宿主 checkout 的工具链（`deepseek-harness/node_modules/.bin` 下的
tsc / tsdown，见 package.json scripts）——克隆本包仓库后需先准备好一份 dsh
检出，并把 `node_modules/@deepseek-ai/*` peer 按 junction 接到宿主（Windows
开发态的既有接线方式）。各模块的行为 eval（意图/回归用例）位于
`modules/<m>/eval/`，框架与运行方式见各模块 eval README。

## License

[MIT](LICENSE)
