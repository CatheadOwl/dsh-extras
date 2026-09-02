---
description: extras 的 prompt 模块——原 prompt-middleware（ctx.promptMiddleware provider registry + user prompt path relates additionalContext 注入），吸收 prompt-parse 与 workspace-tree 为模块内库 src/parse 与 src/tree
---

# prompt 模块（`@catheadowl/dsh-extras` 一行）

`prompt` 是 user prompt enrichment 的小框架：在 `agent/pre-step`
中解析本轮直接用户提示词，产出 `ResolvedPromptPath[]`，再运行注册的 provider，
把 per-path relates contribution 聚合成一条 plugin-sourced `UserMessage`。

设计控制面见 `workunits/prompt-middleware/README.md`（开发仓库纯文本引用）。
本插件只实现承载层，不内置 cognition 或面包屑业务逻辑。

## 提供面

| 面 | 说明 |
|---|---|
| `ctx.promptMiddleware` | `register(provider)` / `registerRelates(provider)` / `list()` / `listViews()` / `disabledIds()` / `setDisabled(names)` / `run(options)` / `clearSession(sessionId)` |
| `registerPromptMiddlewareProvider(ctx, provider)` | 消费插件的硬 import 注册入口；内部仍通过 `ctx.inject(['promptMiddleware'], ...)` 软依赖 |
| `agent/pre-step` driver | 解析直接 user prompt，运行 provider，向 accepted enter batch 追加 relates 上下文 |
| Typert Remote `promptMiddleware` | `list` / `setDisabled`：Settings → Plugins → Prompt Middleware 配置面（provider 开关） |
| client 半 | `settings.plugins.tab` slot（id `prompt-middleware`）：扁平 provider 列表 + 开关，localStorage 持久化（经 extras 嵌套 client 锚点包 `@catheadowl/dsh-extras-client` 的合成 bundle 装载，见 `modules/client/README.md`） |

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

`mode` 默认 `'always'`（每轮都跑都注入）。`'once'` 按
`(sessionId, provider, path)` 去重：同一 session 内某路径已注入过就跳过（只比 key，
不比 description 值），直到该 session 发生 surface replace（compact 等）触发
`clearSession` 后重新注入。`sessionId` 由 `agent/pre-step` driver 从 `agent.session`
提供；无 `sessionId` 的独立调用按 `'always'` 处理。W7 的规范入口见
`workunits/prompt-middleware/spec/once-injection-dedupe.md`（纯文本引用）。
计算去重（`once-dedup-compute`）与预算截断记账（`injection-ledger-vs-render-budget`）已落地；
stale 值比较已决策 defer（见 ADR 0001（`workunits/prompt-middleware/ADR/0001-once-semantics-lane.md`，纯文本引用）），
增量失效走 Lane C 设计笔记（`once-stale-incremental-invalidation`）。

声明式面（`registerRelates`）让消费者只写单 path 的 `resolve` + 一个稳定 `kind`，
框架物化为 imperative provider 并复用同一 runner（once ledger / 聚合 / 预算 / 超时 /
降级 / 渲染）。默认 `once`，`mode: 'always'` 显式 opt-in；显式 `'once'` 与空 `kind`
在注册期 fail loud。契约见
`workunits/prompt-middleware/spec/declarative-enricher-api.md`（纯文本引用）。

provider 开关（W10）：Settings → Plugins → Prompt Middleware 按 provider name
全局开关。被关 provider 不进任何 pre-step 执行路径（开关即契约），禁用方向下一轮
即停；重新打开后本会话已展示过的内容不重复（`once` 语义原样，直到 surface replace /
新会话恢复）。开关是纯执行过滤，不触碰 once 账本（ADR 0002）。持久化在浏览器
localStorage，host 只有内存镜像。契约见
`workunits/prompt-middleware/spec/provider-toggles-ui.md`（纯文本引用）。

## 本机命令（extras 包根 scripts）

```powershell
# 从 dsh-plugin-dev/extras
pnpm run check-types:prompt
pnpm run build:prompt
pnpm run test:prompt    # 库(parse/tree) + 框架 + wire + client-storage
# 组合测试：真实 agent-loop + mock adapter，验证 `once` 去重 + surface replace（compact）清账
# 不在 verify 内：依赖 host 源码 junction（见下），新克隆 / 非本机不可跑
cd modules\prompt ; node --test --test-isolation=none test/composition.test.mjs
```

junction 层在 extras 包根 `node_modules/`（全模块共享）；
`test/wire.test.mjs` 需要 `dsh-typert-registry`、`dsh-api-gateway` junction；
组合测试额外需要 `dsh-system-prompt`、`dsh-tools`、`dsh-agent-loop` junction，
any_routes 引入开发仓库同级模块的 lib 产物（相对路径仅存在于测试源码中，
routes 迁入 extras 后改指模块内路径）。**不要在此目录跑 `pnpm install`**。

## 模块内库（原纯库吸收）

文档入口：[docs/README.md](docs/README.md)。

- `src/parse/`（原 `@catheadowl/dsh-prompt-parse`）：fuzzy/parse/resolve 纯库，
  契约文档 [docs/parse.md](docs/parse.md)；
- `src/tree/`（原 `@catheadowl/dsh-workspace-tree`）：gitignore-aware 枚举
  （vendored `ignore`），契约文档 [docs/tree.md](docs/tree.md)。
  两库不再单独发布（抽取规则：第二个外部消费者出现时再抽）。

## 边界

- `src/parse` 是模块内纯库，不升格为插件（吸收自原 prompt-parse 包）。
- `ctx.fileReferences` 仍是 host/file candidate seam，不被替代。
- breadcrumb-description 已由 `any_routes` 经 `registerRelates` 声明式落地
  （`createBreadcrumbDescriptionProvider` / `resolveBreadcrumbPath`）；cognition-link 已由 coggit 插件经
  `registerRelates` 落地，契约见
  `workunits/prompt-middleware/spec/declarative-enricher-api.md`（纯文本引用） 与
  `workunits/prompt-middleware/spec/cognition-link-provider.md`（纯文本引用）。
- v0 不做 prompt rewrite / blocking / provider 注册参数编辑 UI（priority / kind / mode
  在配置面只读展示，编辑是另一个问题域）。W10 已落地 provider 开关配置面。
