---
description: vendored ignore@5.3.2 的来源/改动/为何 vendor，供 workspace-tree 做 .gitignore 匹配复用
---

# vendored: ignore@5.3.2

Vendored from the npm package [`ignore`](https://www.npmjs.com/package/ignore) v5.3.2 (github: kaelzhang/node-ignore), MIT license.

- `index.cjs` = upstream `index.js`, copied verbatim; the only change is the `.cjs` extension so Node treats it as CommonJS inside this ESM package.
- `index.d.cts` = a narrowed local declaration for the two methods this package uses (`add`, `ignores`); it is NOT the upstream typings.
- `LICENSE-MIT` = upstream license, retained verbatim.

Why vendored: this package must enumerate the workspace without a network install (the npm registry is unreachable in this environment). `ignore` is zero-runtime-dependency and MIT, so vendoring its self-contained build keeps this package self-contained. Source file obtained from the host's pnpm store at `deepseek-harness/node_modules/.pnpm/ignore@5.3.2/node_modules/ignore/index.js`.
