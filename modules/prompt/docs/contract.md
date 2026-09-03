---
description: prompt 模块注入契约——provider 执行模型与定序、once 注入去重、声明式 registerRelates 与 subjectOf、provider 开关的权威规范
---

# prompt 注入契约（contract）

本文是 prompt 模块运行时契约的权威文本：provider 执行模型与定序、`once` 注入
去重与记账、声明式 `registerRelates`（含 `subjectOf` 重键）、render budget 与
provider 开关。注册示例与公共 API reference 见 [register.md](register.md)。

## provider 执行模型（imperative）

- provider 只返回结构化 contribution（`PromptRelatesContribution[]`），不拼最终
  prompt，不改写用户消息，不阻断轮次。
- 排序：`priority` 升序，同 `priority` 按注册序稳定 tiebreak。
- provider name 重复在注册期 fail loud（词表 `/^[a-z][a-z0-9-]*$/u`）。
- 超时：per-provider `timeoutMs`，缺省走 middleware 配置 `providerTimeoutMs`。
- 失败粒度：单个 provider 抛错/超时 → 该 provider trace `failed`，不阻断其他
  provider、不阻断轮次。
- 同轮内 merge/dedupe：dedupe 判定键为 `path + kind + href/value`；胜者按注册序
  裁决（`priority` 不兼做冲突赢家）。`value` 与 `href` 同时给出时渲染优先
  `value`，轮内 dedupe key 用 `href`（缺省回退 `value`）。
- render budget：合并后的内容按 `renderBudgetChars` 截断渲染为
  additionalContext；模型不可见注入通道，不改写用户消息。

## once 注入去重

- `mode` 默认 `'always'`；声明 `'once'` 才启用跨轮 ledger。
- 去重键为 `(sessionId, provider, key)`；`key` 是提及路径，声明式 provider 声明
  `subjectOf` 时是其投影 subject（见下）。同一 subject 的兄弟提及共享记账：已注入
  过该 subject 的 session 内，换个兄弟文件再提也不重复注入。
- 跳过时 trace 记 `already injected this session`。
- `sessionId` 缺失时不建立去重作用域，退化为 `always`。
- provider 没有产出有效 contribution 时不记账。
- **记账只记实际渲染**：只有未被 render budget 截断的 item 写入 ledger；被截断的
  item 不记账，后续轮次预算宽松时可补注。
- **执行位置**：once-mode provider 执行前，middleware 按 ledger 预过滤
  `input.paths`，只传未注入 key 的 path（省算：已注入 path 不再调 provider）；
  全部命中时写 `skipped` trace（`all paths already injected this session`），不调
  provider。ledger 只比 key，不比 description/value。
- **surface replace 清账**：session surface 被 replace（例如 compact）时，driver
  调 `clearSession(sessionId)` 清空该 session 全部 ledger，之后可重新注入。ledger
  只在 runner 进程内保存，不落 storage；进程重启后活跃 session 最多重新注入一次。
- 同一轮内的 merge/dedupe 与跨轮 once 去重正交。

## 声明式面（`registerRelates`）

声明式 API 是 imperative `register(provider)` 之上的**薄适配层**：消费者只声明
「对单个 path 产出什么内容、内容的 `kind` 是什么」，框架在注册时物化为 imperative
provider 并沿用既有 runner（once ledger、merge/dedupe、预算、超时、取消、失败降级、
trace 与渲染）。

| 契约项 | 值 |
|---|---|
| 默认模式 | 声明式默认 `once`；`always` 显式 opt-in（字段 `mode?: 'always'`，显式 `'once'` 视为非法） |
| resolver 粒度 | 单 path：`resolve` 每次只处理一个 `ResolvedPromptPath`（同一轮内所有 resolve 共享同一 `input`，`input.turnId` 稳定） |
| 空结果 | `undefined`（或 `null`）表示该 path 无贡献 |
| 结果形状 | `{ value?, href?, meta? }`；`value` 与 `href` 至少其一为非空字符串才产出 item |
| item 命名 | 沿用 `RelatesItem.kind`，一个声明对应一个 `kind`；不引入 `type` 第二套词汇 |
| label | 框架用 `kind` 作占位 label（底层 `label` 必填、渲染层不消费 label，不向模型泄露多余人类标签） |
| priority / timeoutMs | 可选，透传底层 provider；`priority` 语义见「定序」 |
| 注册期校验 | `name` / `priority` / `timeoutMs` 走既有校验；`kind` 非空、`mode` 仅 `'always'`、`subjectOf` 为函数，均 fail loud |
| 失败粒度 | 与 imperative 一致：单次 `resolve` 抛错 → 整个 provider `failed` trace，不阻断其他 provider；v0 不做 per-path 异常隔离 |

per-turn 共享状态（如 snapshot）由 consumer 用闭包自理：需要「每轮建一次、逐 path
复用」的 provider 应在闭包内按 `input.turnId` 惰性构建并缓存一次，用完即弃。

### `subjectOf` 重键

可选**纯函数** `subjectOf(path): string`，把提及路径投影为内容所属 subject：

- **允许的投影**：仅提及路径自身或其祖先目录（slash-canonical）。投影越界由
  物化 `run` 内校验（`projectSubjectStrict`），违规即抛错 → provider `failed`
  trace，不污染整轮；预过滤/分组序使用的投影带安全回退（退回提及路径本身）。
- **重键范围**：contribution 分组 key、once ledger key、once 预过滤统一按投影后
  的 subject 记。兄弟提及共享 subject 时收敛为一组、一 session 一次注入。
- **预过滤省算**：runner 在调 `resolve` 之前同步调用该纯函数做 once 预过滤，
  省算语义不变。函数必须纯且同步。

## 定序

`priority` 只承载 position（path 内 item 显示序 + 预算截断降级序）：有限数、
升序、越小越靠前、越晚被截断；不兼做冲突赢家（precedence 与 position 分离，胜者
按注册序）。path 序 = resolver 序，声明式面不开放 path 重排（确定性默认，零协调）。
分组 key 可重键到 subject：subject 组在其首个提及处出现一次，不因多个兄弟提及
重复。同 `priority` 用注册序稳定 tiebreak。

带宽约定（文档化语义带，不写裸数）：

| 带 | 语义 |
|---|---|
| `0–99` | canonical / 权威链接 |
| `100–199` | annotation / 描述 |
| `200+` | diagnostic / 状态（预留） |

## provider 开关

Settings → Plugins → **Prompt Middleware** tab（slot id `prompt-middleware`），
按 provider name **全局**开关：

- **开关即契约**：被关 provider 永不进入 pre-step 注入路径，无静默覆盖。
- **单一过滤点**：`PromptMiddlewareRunner.run()` 遍历 `listEntries()` 处——先查
  `options.disabled`，命中即 trace `skipped`（reason `disabled by user`）并跳过，
  过滤发生在 once 过滤之前、不调用 provider。这是唯一的过滤点。
- **与 once 账本无交互**：开关是纯执行过滤，不触碰 ledger；被关期间不记账也不
  清账，re-enable 后同一会话已注入的 key 仍抑制（`once` 语义原样），直到 surface
  replace / 新会话。禁用方向热生效：下一轮即停。
- **持久化**：浏览器 localStorage，key `dsh.promptMiddleware.disabled`（JSON name
  列表）；host 只有内存镜像（页面加载与每次拨开关时由 UI 重推）。
- **视图字段**：name、kind（仅声明式 provider 有值；imperative 显示占位）、
  priority、timeoutMs、mode、source（`imperative` / `declarative`）、enabled。
- 配置数字（`providerTimeoutMs` / `totalTimeoutMs` / `renderBudgetChars`）不进本
  UI——已由 `ConfigSchema` 挂在宿主标准 configurable-plugins 配置面。
