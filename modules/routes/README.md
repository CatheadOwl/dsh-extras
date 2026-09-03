---
description: extras 的 routes 模块——any_routes 工具（陌生 Markdown 知识库的路由视图：扫 README 描述生成可选 routePath 清单）与 breadcrumb-description-enricher（prompt 注入：为用户提到的路径补祖先目录面包屑）
---

# routes 模块（`@catheadowl/dsh-extras` 一行）

**价值**：两个互补的模型面——`any_routes` 让 agent 在陌生 Markdown 知识库中
快速选定下一步要读的路径（路由视图替代盲目录扫描）；breadcrumb 注入让用户
提到某路径时会话自动获得其祖先目录的定向说明，无需翻文档。

**与宿主的关系**：`any_routes` 是 dsh 会话里的一个模型可见工具（扫描根取自
会话 cwd，从不接受调用参数）；breadcrumb 是 prompt 模块
（`ctx.promptMiddleware`）的声明式 provider——prompt 模块缺席时该注入不生效。

- `any_routes`: scan Markdown files under the session workspace (the scan root is derived from `exec.agent.session.header.cwd`, never a call argument), read each file's description, and return a routing view (flat route lines or a tree) for choosing a `routePath` in an unfamiliar Markdown knowledge base.
- `breadcrumb-description-enricher`: consume the prompt-middleware `path list` and add breadcrumb descriptions from ancestor README nodes for each mentioned path. The contribution is keyed by the target's directory (a declared `subjectOf` projection): files are read, not described — only ancestors orient — so sibling files share one group and one injection per session.

Routing-view rule: a **folder** is represented by the README one level down (`folder/README.md`) — the route line shows the folder path plus that README's description; a **plain Markdown file** shows its full relative `.md` path plus its description. A folder cut off by the scan `depth` still keeps its own README description, so the line reads `[truncated: N] folder | description`.

## Development loop (no dsh restart)

业务逻辑(扫描 / 投影 / 描述提取)都是普通函数,改完直接构建 + 跑 fixture 测试即可,不用重启 dsh;只有改了 `index.ts` 的注册形状 / `inject` / `cordis.patch.yml` / 插件名才需要 profile boot。分层验证顺序见 `handbooks/dsh-plugin-dev/09-插件开发调试专题.md`（开发仓库 handbooks/dsh-plugin-dev/09-插件开发调试专题.md，纯文本引用）。

From the extras package root (module has no nested package.json — scripts live at the package root):

```bash
pnpm run check-types:routes  # tsc --noEmit -p modules/routes/tsconfig.json
pnpm run build:routes        # tsc -p modules/routes/tsconfig.json  (src/ -> lib/)
pnpm run test:routes         # node --test --test-isolation=none  (test/*.test.mjs)
```

`test/*.test.mjs` uses `node:test` over a temp fixture (no framework, no network), so it runs standalone after a build. `--test-isolation=none` keeps the tests in-process (required inside the dsh file sandbox, where spawning child processes with piped stdio is blocked).

> If `tsc` is not on your PATH, use the dsh host checkout's vendored binary instead
> (host-borrow wiring: see the extras package README development section).

## Install into a dsh profile (only after registration changes)

```bash
dsh plugin add @catheadowl/dsh-extras   # routes 是 extras 包的一行
```

> 工作细节(遍历/忽略边界、depth 截断、描述提取、diagnostics 语义)见开发仓库认知层的 any_routes 条目（纯文本引用，不随包发布）。
