---
description: gates 插件消费面入口——@catheadowl/dsh-extras/register 的最小注册示例、六类提供面与自动生成的公共 API reference
---

# gates register face

`@catheadowl/dsh-extras/register` 是依赖 gates 的插件开发者可 import 的稳定消费面。gates 缺席时消费者插件仍可加载；gates 存在时注册进入同一个 `ctx.gates` 注册表，并自动加入 `/gates`、`gates_run`、轮末执行、增量短路与阻断预算。

## Quickstart

```ts
import type { Context } from '@deepseek-ai/cordis'
import { registerGate } from '@catheadowl/dsh-extras/register'

const definition = {
  id: 'my-plugin-consistency',
  description: 'Check the files owned by my plugin.',
  rationale: 'This check protects a repository invariant; editing the named files is the legitimate repair.',
  on: ['stop', 'manual'],
  level: 'blocking',
  async check(root) {
    return []
  },
}

export function apply(ctx: Context): void {
  registerGate(ctx, definition)
}
```

完整配方、软依赖验证与回滚验证见 [adding-a-plugin-gate](adding-a-plugin-gate.md)。公共契约如下：

<!-- generated: ts-api-reference:start -->
| Symbol | Kind | Source | Summary |
|---|---|---|---|
| GateChangeSet | interface | src/types.ts | Session-recorded change set handed to a gate's `check` (the W2 dirt window, exposed as an input rather than only an internal shortcut hint). |
| GateDefinition | interface | src/types.ts | One registered gate. |
| GateFixer | type | src/types.ts | Repair strategy for a defer-level failure: a contextual subagent or a deterministic command. |
| GateFixerCommand | interface | src/types.ts | Deterministic repair: run a shell command with the workspace root as cwd, synchronously with a timeout. |
| GateFixerSubagent | interface | src/types.ts | Semantic repair for a `defer`-level gate: dispatch a subagent off the main turn to fix the failure (the "旁路执行" half of defer). |
| GateFixerSubagentRequest | interface | src/types.ts | Context-free overlay fields a gate author may provide for a `subagent` fixer, passed through verbatim to `ctx.subagents.start`. |
| GateLevel | type | src/types.ts | Blocking failures steer another step at turn-stop; deferred failures stay in process-local dirty state without steering; advisory results are reported but never steer. |
| GateRemedy | type | src/types.ts | The per-violation repair pointer: manual guidance or a surface-neutral operation id. |
| GateRemedyManual | interface | src/types.ts | Manual repair is legitimate: the guidance states how and why it is safe. |
| GateRemedyOperation | interface | src/types.ts | A dedicated repair operation exists as a tool; referenced by surface-neutral operation id only. |
| GateResult | interface | src/types.ts | Uniform result contract (inherits the host run-gates GateResult shape). |
| GateStatus | type | src/types.ts | Terminal state of one gate run; a skipped gate reused a prior passed result or was cancelled before running. |
| GateTrigger | type | src/types.ts | When a gate runs. |
| GateViolation | interface | src/types.ts | One located problem, shaped so the model can fix it in one pass. |
| registerGate | function | src/register.ts | Register one plugin-owned gate through the gates registry. |
<!-- generated: ts-api-reference:end -->

## 消费面

| 面 | 入口 | 消费者 |
|---|---|---|
| package register face | `@catheadowl/dsh-extras/register` | 插件开发者 |
| service seam | `ctx.gates` | 插件与 gates 内部驱动 |
| agent tool | `gates_run` | 模型 |
| human command | `/gates` | 用户 |
| user skill | `/gates-config-guide` | 显式手势用户 |
| Web client face | `@catheadowl/dsh-extras/client` | Settings → Plugins → Gates |

root entry `@catheadowl/dsh-extras` 只服务 dsh loader，不承诺实现层导出。内部模块、服务类、controller、runner 与脏状态实现都不是公共消费面。

