# @catheadowl/dsh-extras

[English](README.md) | 中文

**做 harness 就是做 docs。**`@catheadowl/dsh-extras` 让你的 [dsh](https://github.com/deepseek-ai/deepseek-harness) agent 所依赖的知识保持健康。它把 dsh 的 turn 收尾 hook 包装成可组合的质量门禁框架——一个注册面（`registerGate`），而不是每个插件各自抢占 hook——并随包交付这句话所要求的文档维护组件：Markdown 链接治理、向会话注入项目知识、知识库路由视图。

`dsh plugin add` 一次全装，每个模块是组合里可独立开关的一行（按行 id 标识），不需要的行关掉即可，互不影响。本包与 dsh 宿主的关系、为什么要包装宿主 hook，见 [docs/host.md](docs/host.md)。

## 安装

```powershell
dsh plugin add @catheadowl/dsh-extras
```

要求：已安装 dsh CLI。所有运行时依赖由 dsh 宿主提供（peerDependencies，`plugin add` 时随宿主解析），本包自身只带少量纯 JS 工具依赖。

## 模块

| 模块 | 行 id | 提供什么 | 文档 |
|---|---|---|---|
| gates | `gates` | 质量门禁框架（`ctx.gates`）：turn 收尾自动运行的可组合 gate 与 `registerGate` 消费面 | [modules/gates/README.md](modules/gates/README.md) |
| markdown | `markdown` | `md_rename` 工具（搬移并改写 Markdown 内链）+ `doc-link` gate + 内置链接事务库 | [modules/markdown/README.md](modules/markdown/README.md) |
| prompt | `prompt` | prompt 注入服务（declarative provider + 内置 parse/tree 库），向会话注入项目知识 | [modules/prompt/README.md](modules/prompt/README.md) |
| routes | `routes` | `any_routes` 工具（Markdown 知识库路由视图）+ breadcrumb relates provider | [modules/routes/README.md](modules/routes/README.md) |

每个模块是宿主插件组合里可独立开关的一行：不共享状态，关掉任何一行，其余模块行为不变。

## 配置

在你的 profile patch 层按行 id 单关一个模块：

```yaml
- id: gates
  disabled: true
```

带默认配置的模块可覆写。各行的全部配置键：

| 行 | 配置键 |
|---|---|
| gates | `maxConsecutiveBlocks`（连续阻断上限，默认 3，耗尽后降级放行） |
| prompt | `providerTimeoutMs` / `totalTimeoutMs` / `renderBudgetChars`（见下例） |
| markdown / routes | 无插件配置键 |

```yaml
- id: prompt
  config:
    providerTimeoutMs: 2000
    totalTimeoutMs: 5000
    renderBudgetChars: 4000
```

模块上下架走包版本更新：升级本包后 `dsh plugin update` 收缩/扩展组合行。

## API 面

除组合行外，本包导出插件开发者消费的稳定子路径：

- `@catheadowl/dsh-extras/gates/register`——gates 插件消费面（`registerGate` + `GateDefinition` / `GateViolation` 类型）。

各模块自己的次级消费面（如 markdown 的仓库级 `gates.yml` 回退）见对应模块文档。
Web Settings Tab（gates / prompt）随本包内嵌合成装载，不需要单独安装。

模块间依赖拓扑与对外消费面（exports 对账）见 [docs/dependencies.md](docs/dependencies.md)。

## 开发

```powershell
# 从仓库根目录
pnpm run build                  # 四模块 lib + client bundle
pnpm run test:gates             # 各模块单测（test:markdown / test:prompt / test:routes）
pnpm run verify:package-face    # exports / facade 校验
pnpm run verify:publish-readiness  # 发布卫生校验（docs locality、host closure 等）
```

开发细节——宿主 checkout 摆放、工具链借用、peer junction 接线、host-closure 网络检查——见 [docs/development.md](docs/development.md)。

## 已知限制

- 需要 dsh CLI（本包是插件载体，不是独立应用）；运行时 peer 全部由宿主闭包提供。
- 根 README 双语（英文主 + 中文），模块页与深度 docs 以中文为主。
- Settings Tab 目前仅 gates / prompt 两行有（随内置 client 子包 `modules/client` 合成装载，不单独发布）。
- gates 连续阻断上限（`maxConsecutiveBlocks`，默认 3）耗尽后**降级放行**——是安全阀不是正确性保证；markdown / routes 行无插件配置键。

## License

[MIT](LICENSE)
