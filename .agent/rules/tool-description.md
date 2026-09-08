---
description: extras 包模型可见工具描述 rules seed（TD-1..4）——单一 SSOT 入口、承重句保护、改动过 eval、token 软上限；适用于包内所有 model-facing tool description；生成时控制写作、评审时原样嵌入 dispatch prompt
---

# extras · tool-description rules

模型可见工具描述（model-facing tool description）的 **rules SSOT seed**，双端消费：
生成时（经 `AGENTS.md` 指针加载）控制写作；评审时（review 技能的 dispatch prompt
**原样嵌入**本文件）对照，finding 引用 rule id。适用于包内所有工具 row 的
description；规则只写期望形态，理由归认知层/决策史。id 一经评审/gate 引用即
不改号，作废标「已废弃」不复用。

- **TD-1〈single-ssot-entry〉**：每条工具描述的唯一权威定义是所在模块的
  `src/tool-description.ts` 导出常量（无此文件的模块新建，不另设副本）；
  镜像面（eval fixtures、README、package.json description）一律随 SSOT
  同步，只改镜像不改 SSOT 即违规。description-contract 测试锁定 SSOT 唯一，
  镜像一致性靠同步 checklist。
  探针：`grep -rn "<description 文本片段>" src/` 命中数 > 1。基线：should-fix。
- **TD-2〈load-bearing-clauses〉**：消解已登记误读的子句是承重句——每条
  承重句对应模块 comprehension eval rubric 的 known-intentional 清单里
  一条它消解的误读（如：路由行相对口径、truncation 计数语义、计数字段
  口径、内容边界）。删除或改写承重句必须给出替代消解手段，且 rubric
  清单仍被覆盖；游离句（不落在用途/行语法/不变量/边界任一结构段的句子）
  不得新增。
  证据锚：各模块 `eval/comprehension/rubric.md`（包内随行）。基线：should-fix。
- **TD-3〈eval-gate-on-change〉**：description 改动 = 模型可见行为变更，
  与工具逻辑改动同级——合入前重跑该模块 comprehension eval，语义理解
  不劣化方可通过；新增/删除子句都在此列。基线：should-fix。
- **TD-4〈token-budget〉**：单条 description 软上限约 150 英文词
  （~200 token）——工具描述进入每个对话 turn 的 system prompt，低频调用
  时是纯开销。超出上限需在改动说明中指明新增子句消解的具体误读
  （与 TD-2 同一口径）。基线：nit。
