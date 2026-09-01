---
description: prompt-middleware eval——behavior harness 用例(注入接线 smoke)
---

# prompt-middleware eval

本目录只有 behavior harness 用例,复用 `../../eval`（开发仓库 `dsh-plugin-dev/eval/README.md`，纯文本引用） 的共享 runner
(`dsh-eval.mjs`)。

## 用例

| 用例 | 模式 | 验证 |
|---|---|---|
| `behavior/mock/injection-smoke.eval.mjs` | mock(免 key) | 单轮 path mention 恰好注入一条 prompt-middleware `relates:` user/message |

> 单次 headless 调用只跑一个 turn,因此上述 smoke 只证明「接线」(sessionId → provider → 注入)。
> `once` 跨轮去重与 compact 清空由插件级组合测试
> [`../test/composition.test.mjs`](../test/composition.test.mjs) 覆盖:真实 agent-loop + mock
> adapter,连做「轮 1 注入 → 轮 2 去重 → surface replace(compact)→ 轮 3 重新注入」三连断言。
> 该组合测试依赖 host 源码 junction,不在 `pnpm verify` 内(命令见插件 README「本机命令」)。

## 运行

```bash
cd dsh-plugin-dev
node eval/bin/dsh-eval.mjs run --profile headless --repo ../deepseek-harness --mode mock \
  prompt-middleware/eval/behavior/mock/injection-smoke.eval.mjs
```

前置:`deepseek-harness` 的 CLI 已构建(`apps/cli/lib/bin.js`),且 headless profile 已装
`prompt-middleware` 与 `any_routes`。
