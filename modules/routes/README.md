---
description: Out-of-tree dsh plugin registering the `any_routes` Markdown routing-view tool and `breadcrumb-description-enricher` prompt-middleware, with route-line rules, no-restart dev loop, and profile-install steps.
---

# any_routes

`any_routes` is a dsh out-of-tree plugin that registers one tool and one prompt-middleware provider:

- `any_routes`: scan Markdown files under the session workspace (the scan root is derived from `exec.agent.session.header.cwd`, never a call argument), read each file's description, and return a routing view (flat route lines or a tree) for choosing a `routePath` in an unfamiliar Markdown knowledge base.
- `breadcrumb-description-enricher`: consume the prompt-middleware `path list` and add breadcrumb descriptions from ancestor README nodes for each mentioned path. The contribution is keyed by the target's directory (a declared `subjectOf` projection): files are read, not described — only ancestors orient — so sibling files share one group and one injection per session.

Routing-view rule: a **folder** is represented by the README one level down (`folder/README.md`) — the route line shows the folder path plus that README's description; a **plain Markdown file** shows its full relative `.md` path plus its description. A folder cut off by the scan `depth` still keeps its own README description, so the line reads `[truncated: N] folder | description`.

## Development loop (no dsh restart)

业务逻辑(扫描 / 投影 / 描述提取)都是普通函数,改完直接构建 + 跑 fixture 测试即可,不用重启 dsh;只有改了 `index.ts` 的注册形状 / `inject` / `cordis.patch.yml` / 插件名才需要 profile boot。分层验证顺序见 `handbooks/dsh-plugin-dev/09-插件开发调试专题.md`（开发仓库 handbooks/dsh-plugin-dev/09-插件开发调试专题.md，纯文本引用）。

From inside the plugin directory:

```bash
cd dsh-plugin-dev/extras/modules/routes
pnpm run check-types   # tsc --noEmit -p tsconfig.json
pnpm run build         # tsc -p tsconfig.json  (src/ -> lib/)
pnpm run test          # node --test --test-isolation=none  (auto-discovers test/*.test.mjs)
```

`test/*.test.mjs` uses `node:test` over a temp fixture (no framework, no network), so it runs standalone after a build. `--test-isolation=none` keeps the tests in-process (required inside the dsh file sandbox, where spawning child processes with piped stdio is blocked).

> If `tsc` is not on your PATH, run from the repository root with the vendored binary instead:
> `dsh-plugin-dev/coggit/node_modules/.bin/tsc.CMD -p dsh-plugin-dev/extras/modules/routes/tsconfig.json`

## Install into a dsh profile (only after registration changes)

```bash
dsh plugin --profile headless add D:/Document/Projects/dsh/dsh-plugin-dev/extras/modules/routes
```

> 工作细节(遍历/忽略边界、depth 截断、描述提取、diagnostics 语义)见源码根认知 `dsh-plugin-dev_cognition/any_routes/`。
