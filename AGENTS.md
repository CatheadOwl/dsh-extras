---
description: extras 包入口——包形态概览；包独立性 rules seed（PKG-1..9 + intentional-design 豁免清单）在 .agent/rules/package-independence.md，生成时按它控制写作、评审时原样嵌入
---

# AGENTS.md

`@catheadowl/dsh-extras` is a single-package multi-row Cordis plugin carrier: each `modules/<m>/` is a runtime-independent dsh plugin row. Package face, layout, and commands: [README.md](README.md).

**Rules seed**：包独立性目标（PKG-1..9 + intentional-design 豁免清单）的
rules SSOT 在
[.agent/rules/package-independence.md](.agent/rules/package-independence.md)——
生成时按它控制写作（本文件不承载规则正文），评审时原样嵌入 dispatch
prompt，finding 引用 rule id；publish gate 违规消息同带 rule id 前缀。
