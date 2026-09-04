---
description: extras 的 prompt 模块——user prompt enrichment 小框架：解析本轮用户提示词中的路径引用，运行 provider 注入 per-path relates 上下文（ctx.promptMiddleware 注册表 + Web 配置页开关）；内嵌 parse / tree 两个纯库
---

# prompt 模块（`@catheadowl/dsh-extras` 一行）

**价值**：让 dsh 会话在用户提到某个路径时自动获得该路径的定向上下文（面包屑、关联说明等），而不是让模型盲猜或用户手动粘贴——注入只按路径聚合、不改写用户消息、不阻断轮次。

**与宿主的关系**：挂在 dsh 的 `agent/pre-step` 检查点上做一个 provider 注册表（`ctx.promptMiddleware`），本模块只实现承载层，不内置 cognition 或面包屑等业务逻辑——那些由其他插件/模块作为 provider 注册。

## 提供面

| 面 | 说明 |
|---|---|
| `ctx.promptMiddleware` | `register(provider)` / `registerRelates(provider)` / `list()` / `listViews()` / `disabledIds()` / `setDisabled(names)` / `run(options)` / `clearSession(sessionId)` |
| `registerPromptMiddlewareProvider(ctx, provider)` | 消费插件的硬 import 注册入口（`@catheadowl/dsh-extras/prompt/register`）；内部仍通过 `ctx.inject(['promptMiddleware'], ...)` 软依赖 |
| `registerRelatesProvider(ctx, provider)` | 声明式 provider 的硬 import 注册入口（同上子路径）；`resolve` + `kind` 由框架物化为 provider 并复用整套 runner。注册示例与 API reference 见 [docs/register.md](docs/register.md) |
| `agent/pre-step` driver | 解析直接 user prompt，运行 provider，向 accepted enter batch 追加 relates 上下文 |
| Typert Remote `promptMiddleware` | `list` / `setDisabled`：Settings → Plugins → Prompt Middleware 配置面（provider 开关） |
| client 半 | `settings.plugins.tab` slot（id `prompt-middleware`）：扁平 provider 列表 + 开关，localStorage 持久化（经 extras 嵌套 client 锚点包 `@catheadowl/dsh-extras-client` 的合成 bundle 装载，见 `modules/client/README.md`） |

## Quickstart（`registerRelatesProvider`）

```ts
import { registerRelatesProvider } from '@catheadowl/dsh-extras/prompt/register'

registerRelatesProvider(ctx, {
  name: 'my-plugin-notes',
  kind: 'my-notes',          // 稳定 kind；mode 默认 'once'（session 内每 path 一次）
  async resolve({ path }) {
    const note = path.kind === 'directory' ? await loadNoteFor(path.path) : undefined
    return note ? { value: note } : undefined
  },
})
```

完整注册示例与 API reference 见 [docs/register.md](docs/register.md)。

## provider 形状

```ts
interface PromptMiddlewareProvider {
  name: string
  priority?: number
  timeoutMs?: number
  mode?: 'always' | 'once'
  run(input: PromptMiddlewareInput): Promise<PromptRelatesContribution[]>
}
```

provider 只返回结构化 contribution，不拼最终 prompt，不改写用户消息，不阻断轮次。
排序为 `priority` 升序，再按注册顺序；重复 provider name fail loud。

`mode` 默认 `'always'`（每轮都跑都注入）；`'once'` 按 `(sessionId, provider, key)` 在 session 内去重，只记**实际渲染**的 item；surface replace（compact 等）触发 `clearSession` 清账后可重新注入。完整 once 记账规则见 [docs/contract.md](docs/contract.md)。

声明式面（`registerRelates`）让消费者只写单 path 的 `resolve` + 一个稳定 `kind`，框架物化为 imperative provider 并复用同一 runner（once ledger / 聚合 / 预算 / 超时 / 降级 / 渲染）。默认 `once`，`mode: 'always'` 显式 opt-in；显式 `'once'` 与空 `kind` 在注册期 fail loud。注册示例与 API reference 见 [docs/register.md](docs/register.md)。

provider 开关：Settings → Plugins → Prompt Middleware 按 provider name 全局开关，是纯执行过滤（被关 provider 不进 pre-step 执行路径），不触碰 once 账本；细节见 [docs/contract.md](docs/contract.md)。

完整注入契约（once 记账、声明式 `subjectOf` 重键、定序、开关过滤点）见 [docs/contract.md](docs/contract.md)。

## 本机命令（extras 包根 scripts）

```powershell
# 从 extras 包根
pnpm run check-types:prompt
pnpm run build:prompt
pnpm run test:prompt    # 库(parse/tree) + 框架 + wire + client-storage
# 组合测试：真实 agent-loop + mock adapter，验证 `once` 去重 + surface replace（compact）清账
# 不在 verify 内：依赖 host 源码 junction（接线方式见包根 README 开发节），新克隆 / 非本机不可跑
cd modules\prompt ; node --test --test-isolation=none test/composition.test.mjs
```

## 模块内库

文档入口：[docs/README.md](docs/README.md)。

- `src/parse/`：fuzzy/parse/resolve 纯库，契约文档 [docs/parse.md](docs/parse.md)；
- `src/tree/`：gitignore-aware 枚举（vendored `ignore`），契约文档 [docs/tree.md](docs/tree.md)。两库不再单独发布（抽取规则：第二个外部消费者出现时再抽）。

## 边界

- `src/parse` 是模块内纯库，不作为插件形态提供。
- `ctx.fileReferences` 仍是 host/file candidate seam，不被替代。
- breadcrumb-description 已由 extras 的 routes 模块经 `registerRelates` 声明式落地（`createBreadcrumbDescriptionProvider` / `resolveBreadcrumbPath`）。声明式契约见 [docs/contract.md](docs/contract.md)。
- v0 不做 prompt rewrite / blocking / provider 注册参数编辑 UI（priority / kind / mode 在配置面只读展示，编辑是另一个问题域）。provider 开关配置面已落地（见上文）。
