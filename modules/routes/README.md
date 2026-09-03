---
description: extras 的 routes 模块——any_routes 工具（陌生 Markdown 知识库的路由视图：扫 README 描述生成可选 routePath 清单）与 breadcrumb-description-enricher（为用户提到的路径自动补祖先目录的说明）
---

# routes 模块（`@catheadowl/dsh-extras` 一行）

**价值**：两个互补的模型面——`any_routes` 让 agent 在陌生 Markdown 知识库中快速选定下一步要读的路径（路由视图替代盲目录扫描）；breadcrumb 注入让用户提到某路径时会话自动获得其祖先目录的定向说明，无需翻文档。

**与宿主的关系**：`any_routes` 是 dsh 会话里的一个模型可见工具（扫描根取自会话 cwd，从不接受调用参数）；breadcrumb 是 prompt 模块（`ctx.promptMiddleware`）的声明式 provider——prompt 模块缺席时该注入不生效。

## Quickstart

对一个陌生知识库调 `any_routes`（默认参数即可），得到的 `routes` 是这样的行：

```
guides/overview.md | 环境搭建总览
notes/x.md | 会话记录
[truncated: 2] guides/containment | Containment notes
```

每行一个可读入口——选一条作为下一轮的 `routePath` 或直接读该文件。

- `any_routes`: scan a Markdown knowledge base and return a routing view for choosing the next path to read — [docs/routes.md](docs/routes.md) covers the details.
- `breadcrumb-description-enricher`: add breadcrumb descriptions from ancestor README nodes for each mentioned path — details in [docs/routes.md](docs/routes.md).

工作细节（遍历边界、depth 截断、diagnostics 语义、路由视图规则）与开发循环见 [docs/routes.md](docs/routes.md)。

## Install into a dsh profile

```bash
dsh plugin add @catheadowl/dsh-extras   # routes 是 extras 包的一行
```
