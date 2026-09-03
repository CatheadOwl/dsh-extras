---
description: prompt 插件消费面入口——@catheadowl/dsh-extras/prompt/register 的最小注册示例（imperative + declarative 双入口）与自动生成的公共 API reference
---

# prompt register face

`@catheadowl/dsh-extras/prompt/register` 是依赖 prompt 模块的插件开发者可 import 的稳定消费面。prompt 行缺席时消费者插件仍可加载（软降级）；在场时注册进入同一个 `ctx.promptMiddleware` 注册表，并复用整套 runner（once 账本 / 聚合 / 预算 / 超时 / 降级 / 渲染）与 Settings 配置页开关。

## Quickstart（declarative，推荐）

声明式只写「一个 path 怎么 resolve + 一个稳定 `kind`」，框架物化为完整 provider：

```ts
import type { Context } from '@deepseek-ai/cordis'
import { registerRelatesProvider } from '@catheadowl/dsh-extras/prompt/register'

const provider = {
  name: 'my-plugin-notes',
  kind: 'my-notes',
  // 省略 mode 默认 'once'：同 session 每 path 只注入一次（compaction 后重新注入）
  async resolve({ path }) {
    if (path.kind !== 'directory') return undefined   // 显式跳过，勿返回空串
    const note = await loadNoteFor(path.path)          // 你的纯读逻辑
    return note ? { value: note } : undefined
  },
}

export function apply(ctx: Context): void {
  registerRelatesProvider(ctx, provider)
}
```

## Quickstart（imperative）

imperative 自己接收整轮输入、返回结构化 contribution：

```ts
import { registerPromptMiddlewareProvider } from '@catheadowl/dsh-extras/prompt/register'

registerPromptMiddlewareProvider(ctx, {
  name: 'my-plugin-enricher',
  mode: 'always',
  async run({ prompt, paths, signal }) {
    return paths.map(p => ({ path: p.path, items: [...] }))
  },
})
```

两条纪律（与 gates 消费面同源）：注册入口内部走 `ctx.inject(['promptMiddleware'])` 条件注入，disposer 随你的 fiber 卸载自动回滚；provider 校验（name/词表/kind）在注册期 fail loud。公共契约如下：

<!-- generated: ts-api-reference:start -->
| Symbol | Kind | Source | Summary |
|---|---|---|---|
| DeclarativeRelatesProvider | interface | src/types.ts | Declarative enrichment provider: the consumer declares how to resolve ONE path plus a stable `kind`; the framework materializes it into an imperative `PromptMiddlewareProvider` and reuses the shared runner (once ledger, merge/ dedupe, budget, timeout, cancel, failure degrade, trace, render). |
| PromptMiddlewareConfig | interface | src/types.ts | No JSDoc summary. |
| PromptMiddlewareInput | interface | src/types.ts | No JSDoc summary. |
| PromptMiddlewareProvider | interface | src/types.ts | No JSDoc summary. |
| PromptMiddlewareProviderEntry | interface | src/types.ts | One registered provider plus its declarative `kind`; imperative providers carry none. |
| PromptMiddlewareProviderMode | type | src/types.ts | Per-session contribution policy for a provider. |
| PromptMiddlewareProviderView | interface | src/types.ts | One row of the Settings → Plugins → Prompt Middleware tab's provider list. |
| PromptMiddlewareRunOptions | interface | src/types.ts | No JSDoc summary. |
| PromptMiddlewareRunResult | interface | src/types.ts | No JSDoc summary. |
| PromptMiddlewareTraceEvent | interface | src/types.ts | No JSDoc summary. |
| PromptMiddlewareTraceStatus | type | src/types.ts | No JSDoc summary. |
| PromptPathKind | type | src/types.ts | Public prompt-middleware contracts. |
| PromptRelatesContribution | interface | src/types.ts | No JSDoc summary. |
| PromptRelatesGroup | interface | src/types.ts | No JSDoc summary. |
| registerPromptMiddlewareProvider | function | src/register.ts | No JSDoc summary. |
| registerRelatesProvider | function | src/register.ts | Hard-import registration face for declarative relates providers. |
| RelatesItem | interface | src/types.ts | No JSDoc summary. |
| RelatesResolveContext | interface | src/types.ts | One resolved path plus the full turn input, handed to a declarative `resolve`. |
| RelatesResolveResult | interface | src/types.ts | What a declarative resolver produces for one path. |
| ResolvedPromptPath | interface | src/types.ts | No JSDoc summary. |
<!-- generated: ts-api-reference:end -->

## 消费面

| 面 | 入口 | 消费者 |
|---|---|---|
| package register face | `@catheadowl/dsh-extras/prompt/register` | 插件开发者 |
| service seam | `ctx.promptMiddleware` | 插件与 prompt 内部 driver |
| agent/pre-step driver | 宿主检查点 | 注入通道（模型不可见，不改写用户消息） |
| Web client face | `@catheadowl/dsh-extras/client` | Settings → Plugins → Prompt Middleware |

root entry `@catheadowl/dsh-extras` 只服务 dsh loader，不承诺实现层导出。内部模块、service 类与 runner 实现都不是公共消费面。
