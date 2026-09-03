---
description: extras 包入口——包形态概览与约定；包独立性 rules seed 在 .agent/rules/package-independence.md（评审时原样嵌入）
---

# AGENTS.md

`@catheadowl/dsh-extras` is a single-package multi-row Cordis plugin carrier: each `modules/<m>/` is a runtime-independent dsh plugin row. Package face, layout, and commands: [README.md](README.md).

**Rules seed**：包独立性目标（PKG-1..5）的 rules SSOT 在
[.agent/rules/package-independence.md](.agent/rules/package-independence.md)——
生成时按它控制写作，评审时原样嵌入 dispatch prompt，finding 引用 rule id。

## Conventions

- **Published docs are self-contained**: readers have only this package. README/docs/eval link in-package paths only; cite out-of-package sources by name ("upstream doc", "original design record"), never by path directions.
- **Relative path tokens in prose resolve in-package**: escaping or dangling forms fail `scripts/verify-publish-readiness.mjs` (docs locality); forms the gate cannot judge are governed by the rules seed.
- **Example data uses neutral namespaces** (`guides/`, `notes/x.md`), never a real repository's namespaces — examples must not be misread as citations.
- **Comments carry functional semantics only**; design attribution (why it is designed this way, decision provenance) lives in the cognition layer, not in source comments.
- **Host borrows are the documented exception**: `deepseek-harness` checkout paths and `@deepseek-ai/*` host packages are legal in dev-time wiring — runtime is provided by the dsh host, and the publish gates carry the matching exemptions.
