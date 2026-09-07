---
description: schema-intent review 的隐藏答案钥匙——每场景唯一正确动作（orient→any_nav、known-path→read、content-search→grep）及各误选所误读的 schema 属性，另列两条有意为之的不算缺陷项
---

# schema-intent rubric — answer key

Each scenario has exactly one correct next action from { read, grep, any_nav }. The reviewer (a fresh model) must pick it from the schema + scenario alone.

## Per-scenario key

| scenario | correct | wrong — and the schema property it misreads |
|---|---|---|
| s1-orient | any_nav | read / grep: there is no target yet; the "Use before exploring an unfamiliar Markdown knowledge base" clause is the trigger to route first. |
| s2-known-path | read | any_nav: the exact path is already known, so routing is wasted work (over-use). |
| s3-content-search | grep | any_nav: it returns route paths and descriptions, never file content, so it cannot answer "which file mentions X". |

## Accepted intent (do NOT count these as defects)

1. **The schema never hints the terminal `read` step.** Deliberate: the terminal action is intent-dependent, and a "next do X" hint would be a next-hint (see the upstream structured next-hint design note). The schema's answer is the "never file content" boundary — it states what the tool does NOT return, not which tool to call next.
2. **The schema does not say where descriptions come from.** Deliberate: the tool is a router; the model only needs "description may be present or absent" (`when present`), not the extraction algorithm.
