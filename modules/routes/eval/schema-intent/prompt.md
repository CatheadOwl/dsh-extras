---
description: schema-intent review 的盲评 prompt 模板——fresh model 仅凭三个工具（read/grep/any_nav）的 schema 与场景描述选下一步动作，按固定单行格式作答
---

You are a fresh coding agent. You have three tools: `read` (read a file's text), `grep` (search file contents), and `any_nav` (the routing-view tool described below). For each scenario, decide the ONE action you would take NEXT and answer with exactly one of the three tool names.

{{EVAL_OBSERVATIONS}}

Answer in exactly this format, one line per scenario, nothing else:

s1-orient: <action> s2-known-path: <action> s3-content-search: <action>

The action must be exactly one of: read, grep, any_nav. Do not explain, do not qualify, do not invent tools or steps beyond these three.
