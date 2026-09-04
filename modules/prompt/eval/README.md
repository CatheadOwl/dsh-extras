---
description: prompt-middleware eval——behavior harness 用例(注入接线 smoke)
---

# prompt-middleware eval

本目录只有 behavior harness 用例,复用共享 eval 框架 `@catheadowl/dsh-eval`（extras 的 devDependency）。

## 用例

| 用例 | 模式 | 验证 |
|---|---|---|
| `behavior/mock/injection-smoke.eval.mjs` | mock(免 key) | 单轮 path mention 恰好注入一条 prompt-middleware `relates:` user/message |
| `behavior/real/locate-exemption-mention.eval.mjs` | real(需 key) | 定位型任务（提及变体）：找到豁免规范文档并引用 marker 句 |
| `behavior/real/locate-exemption-topic.eval.mjs` | real(需 key) | 定位型任务（主题变体）：零 path 提及的同题定位 |
| `behavior/real/run-relates-ab.mjs` | real A/B 驱动 | 双臂（`disabledProviders` 差异）× N 次跑定位 case，trace 机械指标 + 臂守卫，产出到 `.runs/relates-ab-*`（设计：workunits/prompt-middleware/probe/20260905-relates-behavior-ab.md） |

> 单次 headless 调用只跑一个 turn,因此上述 smoke 只证明「接线」(sessionId → provider → 注入)。`once` 跨轮去重与 compact 清空由插件级组合测试 [`../test/composition.test.mjs`](../test/composition.test.mjs) 覆盖:真实 agent-loop + mock adapter,连做「轮 1 注入 → 轮 2 去重 → surface replace(compact)→ 轮 3 重新注入」三连断言。该组合测试依赖 host 源码 junction,不在 `pnpm verify` 内(命令见插件 README「本机命令」)。

## 运行

```powershell
# 从 extras 包根
pnpm run eval:prompt:mock
```

## 依赖关系（隔离形态）

- 框架 `@catheadowl/dsh-eval` 是 extras 的 **devDependency**（`dsh-eval` bin 消费），仅开发态——不进运行时，也不随包发布（`eval/` 不在 `files` 清单）；
- `--repo` 指向已构建的 dsh 检出——开发期宿主借用，scripts 默认 `../../deepseek-harness`，按本机布局调整。

前置:`dsh plugin --profile headless add @catheadowl/dsh-extras`（prompt 与 routes 行都在包内）。
