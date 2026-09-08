---
description: extras 包入口——包形态概览；rules seeds：包独立性（PKG-1..10 + intentional-design 豁免清单）与模型可见工具描述（TD-1..4），生成时按它们控制写作、评审时原样嵌入
---

# AGENTS.md

`@catheadowl/dsh-extras` is a single-package multi-row Cordis plugin carrier: each `modules/<m>/` is a runtime-independent dsh plugin row. Package face, layout, and commands: [README.md](README.md). Release history lives in [CHANGELOG.md](CHANGELOG.md) — every version bump adds an entry (PKG-10), consumer-facing wording only.

**Rules seeds**（本文件不承载规则正文，生成时按它们控制写作，评审时原样嵌入 dispatch prompt，finding 引用 rule id）：

- 包独立性目标（PKG-1..10 + intentional-design 豁免清单）：[.agent/rules/package-independence.md](.agent/rules/package-independence.md)——publish gate 违规消息同带 rule id 前缀。
- 模型可见工具描述（TD-1..4）：[.agent/rules/tool-description.md](.agent/rules/tool-description.md)——适用于包内所有工具 row 的 description。
