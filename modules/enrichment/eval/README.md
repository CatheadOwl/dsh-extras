---
description: enrichment eval——behavior harness 用例(注入接线 smoke)
---

# enrichment eval

本目录只有 behavior harness 用例,复用共享 eval 框架 `@catheadowl/dsh-eval`（extras 的 devDependency）。

## 用例

| 用例 | 模式 | 验证 |
|---|---|---|
| `behavior/mock/injection-smoke.eval.mjs` | mock(免 key) | 单轮 path mention 恰好注入一条 enrichment `relates:` user/message（断言在 `inspect` hook 读原始 session 事件，故声明 `evidence: 'inspect'`） |
| `behavior/real/orientation-send-window.eval.mjs` | real(需 key) | A/B 定位 case（orientation 臂型）：文案注入下的定位任务 |
| `behavior/real/triage-deprecated-twin.eval.mjs` | real(需 key) | A/B 定位 case（triage 臂型）：文案注入下的甄别任务 |
| `behavior/real/run-relates-ab.mjs` | real A/B 驱动 | 基于框架行为实验面 `defineBehaviorExperiment`（`@catheadowl/dsh-eval/experimental`）：臂 × 重复编排、臂覆写深合并基线、逐 run 守卫与零 guard-clean 臂 INVALID、预注册 decisionRule + 定义指纹随产物落 `.runs/relates-ab-<case>-<stamp>/`；驱动只留领域件（case 语料、指标抽取、守卫语义、判读标准）（设计记录按名引用：relates 行为 A/B 探针原始设计存于开发仓库） |

> 单次 headless 调用只跑一个 turn,因此上述 smoke 只证明「接线」(sessionId → provider → 注入)。`once` 跨轮去重与 compact 清空由插件级组合测试 [`../test/composition.test.mjs`](../test/composition.test.mjs) 覆盖:真实 agent-loop + mock adapter,连做「轮 1 注入 → 轮 2 去重 → surface replace(compact)→ 轮 3 重新注入」三连断言。该组合测试依赖 host 源码 junction,不在 `pnpm verify` 内(命令见插件 README「本机命令」)。

## 运行

```powershell
# 从 extras 包根
pnpm run eval:enrichment:mock
```

## 依赖关系（隔离形态）

- 框架 `@catheadowl/dsh-eval` 是 extras 的 **devDependency**（`dsh-eval` bin 消费），仅开发态——不进运行时，也不随包发布（`eval/` 不在 `files` 清单）；
- `--repo` 指向已构建的 dsh 检出——开发期宿主借用，scripts 默认 `../../deepseek-harness`，按本机布局调整。

前置:`dsh plugin --profile headless add @catheadowl/dsh-extras`（prompt 与 routes 行都在包内）。
