---
description: markdown 模块开发指南——构建/测试命令（101 case）、headless 行为 E2E、node_modules junction 过渡解析
---

# 开发（markdown 模块）

## 构建 / 测试（extras 包根 scripts）

```powershell
# 从 extras 包根
pnpm run check-types:markdown
pnpm run build:markdown
pnpm run test:markdown    # 库 9 套 + plugin + doc-link-gate + metadata-check，共 101 case
```

测试 import 已构建 `lib/`，依赖经 extras 包根 `node_modules` junction 解析（`@deepseek-ai/*` → harness；mdast 解析栈 → host `.pnpm`）。开发期解析说明（嵌套仓库内不要 `pnpm install`）见 [links-lib.md](links-lib.md)。

## E2E 测试（headless behavior harness）

`eval/` 目录用共享 eval 框架（devDep `@catheadowl/dsh-eval`，`dsh-eval` bin）覆盖工具内三层 fallback（deterministic rebase / skip 非阻塞 / conflict 阻塞整单）。case 清单与 out-of-scope 见 `eval/README.md`（行为 eval 目录，不随包发布）。

```powershell
# 从 extras 包根（经 devDep `@catheadowl/dsh-eval` 的 dsh-eval bin）
pnpm run eval:markdown:mock   # mock 层（免 key）
pnpm run eval:markdown:real   # real 层（需 key）
```

前置：extras 包已装进被启动的 `headless` profile（`dsh plugin --profile headless add <extras 目录绝对路径>`）。
