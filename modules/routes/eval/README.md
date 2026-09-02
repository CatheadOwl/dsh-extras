---
description: any_routes 的规范化 eval：以共享 review experiment 描述理解实验，以 dsh headless 执行
---

# any_routes eval

本目录只保存 **any_routes 自己的试验设计**；任务组装、重复执行、产物落盘由共享框架 `@catheadowl/dsh-eval`（extras 的 devDependency，`dsh-review` bin 消费）提供。

## 目录

```text
eval/
  comprehension/
    any-routes.review.mjs  # 试验定义：从冻结输入生成当前版本的真实观测
    fixtures.json          # 冻结输入：Markdown KB 与导航 hops（含工具 schema）
    prompt.md              # 盲评问题；只含 {{EVAL_OBSERVATIONS}} 插槽
    rubric.md              # 隐藏答案键，不发送给 reviewer
  schema-intent/
    schema-intent.review.mjs  # 试验定义：只喂 schema + 场景，问「下一步动作」
    fixtures.json             # 冻结场景：任务 + 动作闭集
    prompt.md                 # MCQ：每场景从 {read,grep,any_routes} 选一
    rubric.md                 # 隐藏答案键：correct/wrong + accepted intent
```

`comprehension/` 测量：新模型能否仅凭 `any_routes` 的工具说明和输出理解 `depth`、`anchor`、`[truncated: N]`、flat/tree 对应关系，并走到目标文档。字段形状本身仍由 `test/routes.test.mjs` 与 `test/navigation.test.mjs` 负责。

`schema-intent/` 测另一个维度：只给工具 schema、不给输出，让 fresh model 从闭集里选「下一步动作」，判定描述本身是否会引导 over-use / under-use / 错误动作。它和 `comprehension/` 互补——后者测「能否读对输出」，前者测「契约是否误导意图」。工具 schema 复用 `comprehension/fixtures.json` 的 `tool` 字段，作为单一冻结来源。

`fixtures.json` 冻结的是输入而不是输出。`any-routes.review.mjs` 每次从临时 Markdown KB 调用当前构建的 `lib/routes.js`，再把临时绝对路径投影成 `<workspace-root>`；因此 projection 修改会自动进入评审证据，不会维护一份易漂移的输出快照。

## 运行

```powershell
# 从 extras 包根
pnpm run build:routes               # 先构建（观测投影用当前 lib/routes.js）
pnpm run eval:routes:dry            # 只组装观测与任务，不调用模型（两个实验都跑）
pnpm run eval:routes:comprehension  # 理解评审（多次独立评审，需凭证）
pnpm run eval:routes:schema-intent  # 意图闭集评审
```

## 依赖关系（隔离形态）

- 框架 `@catheadowl/dsh-eval` 是 extras 的 **devDependency**（`dsh-review` bin 消费），
  仅开发态——不进运行时，也不随包发布（`eval/` 不在 `files` 清单）；
- 真实评审的 `--repo` 指向已构建的 dsh 检出——开发期宿主借用，scripts 默认
  `../../deepseek-harness`，按本机布局调整；dry-run 不需要。

产物在 `comprehension/.runs/any-routes-comprehension/`：`observations.md`、`task.txt`、`run-N.txt` 和运行元数据。逐次答案人工对照 [`rubric.md`](comprehension/rubric.md)；多次一致才视为理解收敛，rubric 中已登记的 intentional design 不重复算缺陷。

工具说明目前仍作为输入契约保存在 `fixtures.json`，修改 `src/index.ts` 中说明时须同步。投影输出不复制，始终由当前 `lib/routes.js` 生成。
