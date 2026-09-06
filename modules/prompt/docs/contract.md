---
description: prompt 模块注入契约——provider 执行模型与定序、once 注入去重与 touch 失效、声明式 registerRelates 与 subjectOf、tool-touch sensor lane、provider 开关的权威规范
---

# prompt 注入契约（contract）

本文是 prompt 模块运行时契约的权威文本：provider 执行模型与定序、`once` 注入去重与记账、声明式 `registerRelates`（含 `subjectOf` 重键）、tool-touch sensor lane（`sources` 订阅、`touchSubjects` 双向投影、账本失效）、render budget 与 provider 开关。注册示例与公共 API reference 见 [register.md](register.md)。

## provider 执行模型（imperative）

- provider 只返回结构化 contribution（`PromptRelatesContribution[]`），不拼最终 prompt，不改写用户消息，不阻断轮次。
- 排序：`priority` 升序，同 `priority` 按注册序稳定 tiebreak。
- provider name 重复在注册期 fail loud（词表 `/^[a-z][a-z0-9-]*$/u`）。
- 超时：per-provider `timeoutMs`，缺省走 middleware 配置 `providerTimeoutMs`。
- 失败粒度：单个 provider 抛错/超时 → 该 provider trace `failed`，不阻断其他 provider、不阻断轮次。
- 同轮内 merge/dedupe：dedupe 判定键为 `path + kind + href/value`；胜者按注册序裁决（`priority` 不兼做冲突赢家）。`value` 与 `href` 同时给出时渲染优先 `value`，轮内 dedupe key 用 `href`（缺省回退 `value`）。
- render budget：合并后的内容按 `renderBudgetChars` 截断渲染为 additionalContext（内容模型可见，信封不渲染本插件名），不改写用户消息。

## once 注入去重

- `mode` 默认 `'always'`；声明 `'once'` 才启用跨轮 ledger。
- 去重键为 `(sessionId, provider, key)`；`key` 是提及路径，声明式 provider 声明 `subjectOf` 时是其投影 subject（见下）。同一 subject 的兄弟提及共享记账：已注入过该 subject 的 session 内，换个兄弟文件再提也不重复注入。
- 跳过时 trace 记 `already injected this session`。
- `sessionId` 缺失时不建立去重作用域，退化为 `always`。
- provider 没有产出有效 contribution 时不记账。
- **记账只记实际渲染**：只有未被 render budget 截断的 item 写入 ledger；被截断的 item 不记账，后续轮次预算宽松时可补注。
- **执行位置**：once-mode provider 执行前，middleware 按 ledger 预过滤 `input.paths`，只传未注入 key 的 path（省算：已注入 path 不再调 provider）；全部命中时写 `skipped` trace（`all paths already injected this session`），不调 provider。ledger 只比 key，不比 description/value。
- **surface replace 清账**：session surface 被 replace（例如 compact）时，driver 调 `clearSession(sessionId)` 清空该 session 全部 ledger，之后可重新注入。ledger 只在 runner 进程内保存，不落 storage；进程重启后活跃 session 最多重新注入一次。
- **touch 失效是账本外的正交机制**：ledger 写者除 `markInjected`（实际渲染记账）与 `clearSession`（surface replace）外，还有 touch 失效摘账（见「tool-touch sensor lane」）——它不改 once 的 key 语义与省算承诺，只是按内容变更信号把 key 从账上摘掉。
- 同一轮内的 merge/dedupe 与跨轮 once 去重正交。

## 声明式面（`registerRelates`）

声明式 API 是 imperative `register(provider)` 之上的**薄适配层**：消费者只声明「对单个 path 产出什么内容、内容的 `kind` 是什么」，框架在注册时物化为 imperative provider 并沿用既有 runner（once ledger、merge/dedupe、预算、超时、取消、失败降级、trace 与渲染）。

| 契约项 | 值 |
|---|---|
| 默认模式 | 声明式默认 `once`；`always` 显式 opt-in（字段 `mode?: 'always'`，显式 `'once'` 视为非法） |
| resolver 粒度 | 单 path：`resolve` 每次只处理一个 `ResolvedPromptPath`（同一轮内所有 resolve 共享同一 `input`，`input.turnId` 稳定） |
| 空结果 | `undefined`（或 `null`）表示该 path 无贡献 |
| 结果形状 | `{ value?, href?, meta? }`；`value` 与 `href` 至少其一为非空字符串才产出 item |
| item 命名 | 沿用 `RelatesItem.kind`，一个声明对应一个 `kind`；不引入 `type` 第二套词汇 |
| label | 框架用 `kind` 作占位 label（底层 `label` 必填、渲染层不消费 label，不向模型泄露多余人类标签） |
| priority / timeoutMs | 可选，透传底层 provider；`priority` 语义见「定序」 |
| description | 可选非空字符串，provider 作者自述一行话，透传物化 provider 并进 Settings 视图；缺省视图不带该字段（渲染退回 name + meta）。注册期校验：给了但非非空字符串即 fail loud |
| 注册期校验 | `name` / `priority` / `timeoutMs` / `description` 走既有校验；`kind` 非空、`mode` 仅 `'always'`、`subjectOf` 为函数，均 fail loud |
| 失败粒度 | 与 imperative 一致：单次 `resolve` 抛错 → 整个 provider `failed` trace，不阻断其他 provider；v0 不做 per-path 异常隔离 |

per-turn 共享状态（如 snapshot）由 consumer 用闭包自理：需要「每轮建一次、逐 path 复用」的 provider 应在闭包内按 `input.turnId` 惰性构建并缓存一次，用完即弃。

### `subjectOf` 重键

可选**纯函数** `subjectOf(path): string`，把提及路径投影为内容所属 subject：

- **允许的投影**：仅提及路径自身或其祖先目录（slash-canonical）。投影越界由物化 `run` 内校验（`projectSubjectStrict`），违规即抛错 → provider `failed` trace，不污染整轮；预过滤/分组序使用的投影带安全回退（退回提及路径本身）。
- **重键范围**：contribution 分组 key、once ledger key、once 预过滤统一按投影后的 subject 记。兄弟提及共享 subject 时收敛为一组、一 session 一次注入。
- **预过滤省算**：runner 在调 `resolve` 之前同步调用该纯函数做 once 预过滤，省算语义不变。函数必须纯且同步。

## tool-touch sensor lane

框架统一持有 `tools/result` 监听，把 agent 的文件工具使用变成第二个信号源。provider 不允许自挂 `tools/result` 做注入——那会绕开 once ledger / 预算 / 渲染纪律。

### sensor 契约

- **工具闭集 `{read, edit}`**（`write` defer：新建文件的空白语义未定）。提取规则：`exec.arguments.file_path` 为 string 且 trim 后非空。
- **准入三条件**：`!result.isError && exec.agent !== undefined && !exec.signal.aborted`——错误、中止、无 agent 的调用不是有效 touch。
- **祖先上浮**：嵌套执行的 touch 沿执行 token 链上浮，在根执行结算——一次嵌套调用只消费一次，归账到根 agent 的 session。
- **键空间归一**：touch 路径按根 session 的 cwd 归一为项目相对、斜杠 canonical 形（Windows 盘符前缀大小写不敏感），与 prompt 侧 once key 同一空间；项目外路径保留绝对形，交 provider 天然忽略。
- **pending 生命周期**：raw touch 记入 per-session pending，在下一步 pre-step 消费；turn 边界（`turn/end`）丢弃残余，不跨 turn 追注。surface replace 不清 pending（turn 作用域，与 ledger 分离）。
- **无 sensor 级路径筛选**：配对与否由 `touchSubjects` 投影决定（返回空数组 = 忽略），render budget 兜底渲染量。

### `sources` 信号源订阅

provider 可选声明 `sources?: Array<'prompt' | 'touch'>`（imperative 与声明式双面同加，域不收窄）：

- 缺省 = `['prompt']`：行为与本 lane 引入前完全一致（只收 prompt 解析路径）。
- 含 `'touch'`：本 provider 额外接收 touch 伪路径。**订阅只决定注入消费，不决定失效**。
- 注册期校验：声明 `'touch'` 而未声明 `touchSubjects` 是死订阅，fail loud；`sources` 非空数组、entry 域合法、`touchSubjects` 为函数，均注册期校验。

### `touchSubjects` 双向投影

可选函数 `touchSubjects?(touchedPath: string, context: { cwd: string; sessionId?: string }): string[]`（双面同加）：

- **纯度口径「无隐藏输入」**：同步计算，不碰 FS、不做 record 时刻的重活；声明方**可以**据 `context` 查表（典型：按 cwd 选 per-project 配置决定 subject 空间），查表本身应同步、缓存化。单参声明继续合法（context 是增量参数，JS 天然兼容）。
- **context 语义**：`cwd` 在摘账点 = sensor 归一该 touch 所用的 session cwd（record 时刻现成可得，零新状态）；在消费投影点 = 当前 pre-step 的 `cwd`。`sessionId` 是 touch 归账的 session（存在时）。context 是投影可见的**全部**会话上下文——record 时刻没有 prompt/paths，框架不虚构。
- **反向（失效，一律执行）**：touch 时框架对产出 subjects 摘 once 账（`(provider, key)` 条目删除）——面向**所有声明者**，与 `sources` 订阅、开关状态无关。被关 provider 的 `run` 永不执行，但其声明仍参与摘账（开关是纯执行过滤，屏蔽失效 = 开关获得账本写权，违背 filter-only）。
- **正向（消费，按订阅过滤）**：下一步 pre-step 对订阅了 `'touch'` 的 provider 再次执行投影，subjects 物化为伪路径进入其 `input.paths`。
- 与 `subjectOf` 互为镜像：后者把「提及」投影为 key（正向 pre-filter），前者把「touch」投影回 subject（反向失效 + 重跑）。`subjectOf` 不加 context——prompt 侧 `resolve`/`run` 本就有完整 input（含 cwd），无此缺口。

### touch 伪路径与 once key

- 伪路径为 `ResolvedPromptPath`：`path = subject`、`origin: 'touch'`、`touchTool`（触发工具名，v0 域 `'read' | 'edit'`）、`kind` 固定 `'file'` 且不参与判定。声明式 `resolve({ path })` 直接从 `path.origin` / `path.touchTool` 读来源。
- **once key = subject 本身**：once 预过滤与 `subjectOf` 对 `origin === 'touch'` 的伪路径**不再二次投影**（预过滤、allowed 集、contribution 分组三处一致）——摘掉的 key 与重记的 key 恒等。prompt 侧 `subjectOf` 语义不变；两侧 key 是否重叠由 provider 的两个声明自行对齐。
- **chatter 消解**：失效重跑 `resolve` 返回 `undefined` → 不渲染 → 不重新记账 → key 保持无账。稳态下每次 touch 只花一次 resolve、零注入零噪音；状态每翻转一次恰好多注一次。

### trace 口径

- trace 事件可选 `source?: 'prompt' | 'touch'`：本批输入含至少一个 touch 伪路径记 `'touch'`（混合批记 `'touch'`），否则 `'prompt'`；纯观测，不参与执行判定。
- 空消费批（provider 无可订阅输入）不执行、不记 trace 行。
- `touchSubjects` 运行期抛错的隔离：消费点收编为该 provider 的 `failed` trace（source `'touch'`）；摘账点跳过该声明者、不影响同批其他声明者。

## 定序

`priority` 只承载 position（path 内 item 显示序 + 预算截断降级序）：有限数、升序、越小越靠前、越晚被截断；不兼做冲突赢家（precedence 与 position 分离，胜者按注册序）。path 序 = resolver 序，声明式面不开放 path 重排（确定性默认，零协调）。分组 key 可重键到 subject：subject 组在其首个提及处出现一次，不因多个兄弟提及重复。同 `priority` 用注册序稳定 tiebreak。

带宽约定（文档化语义带，不写裸数）：

| 带 | 语义 |
|---|---|
| `0–99` | canonical / 权威链接 |
| `100–199` | annotation / 描述 |
| `200+` | diagnostic / 状态（预留） |

## provider 开关

Settings → Plugins → **Prompt Middleware** tab（slot id `prompt-middleware`），按 provider name **全局**开关：

- **开关即契约**：被关 provider 永不进入 pre-step 注入路径，无静默覆盖。
- **单一过滤点**：`PromptMiddlewareRunner.run()` 遍历 `listEntries()` 处——先查 `options.disabled`，命中即 trace `skipped`（reason `disabled by user`）并跳过，过滤发生在 once 过滤之前、不调用 provider。这是唯一的过滤点。
- **与 once 账本无交互**：开关是纯执行过滤，不触碰 ledger；被关期间不记账也不清账，re-enable 后同一会话已注入的 key 仍抑制（`once` 语义原样），直到 surface replace / 新会话。禁用方向热生效：下一轮即停。
- **持久化**：浏览器 localStorage，key `dsh.promptMiddleware.disabled`（JSON name 列表）；host 只有内存镜像（页面加载与每次拨开关时由 UI 重推）。
- **视图字段**：name、description（可选；provider 作者自述，imperative 与声明式面都可选给）、kind（仅声明式 provider 有值；imperative 显示占位）、priority、timeoutMs、mode、source（`imperative` / `declarative`）、enabled。
- 配置数字（`providerTimeoutMs` / `totalTimeoutMs` / `renderBudgetChars`）不进本 UI——已由 `ConfigSchema` 挂在宿主标准 configurable-plugins 配置面。

### 双入口（config `disabledProviders`）

插件 config 的 `disabledProviders?: string[]` 是第二个禁用入口——部署者意志的通道，headless / web / CLI 一致可达（headless 经 profile `--patch` overlay）。与浏览器开关面的关系：

- **合并语义：并集**（任一入口说禁即禁）。config 是部署者意志、UI 是用户意志，禁用比启用更保守；对 eval A/B 场景安全——B 臂的 patch 禁用不会被人在 UI 里点开。`PromptMiddlewareService.run()` 对 config 集合、浏览器镜像、caller 传入集合各自做并集后交给 runner。
- **来源归属**：runner 先查 `options.configDisabled`（记 reason `disabled by config`）再查 `options.disabled`（记 `disabled by user`）——同一 provider 双禁时归属 config（更硬的意志）。过滤位置与顺序语义同上（先于 once 过滤、不触碰账本）。
- **集合独立性**：service 内 config 名单与浏览器镜像是两个独立集合；`setDisabled()` 整体替换浏览器镜像，**不会**冲掉 config 名单。
- **未知名忽略**：provider 注册晚于 config 加载，无法预校验「已注册名」；未知名运行期 match nothing、无害（与 gates 的 disabled 口径一致）。
- **显示口径**：`listViews()` 的 `enabled` 只反映用户开关（浏览器镜像）；config 禁用的 provider 在 UI 中仍显示为已启用——UI 是用户意志的面，不反映部署层。要部署层可见，消费 `introspect()`（见下节）。

### 自省快照（`introspect()`）

`PromptMiddlewareService.introspect()`（remote `promptMiddleware/introspect`）是只读自省面：每个注册 provider 一行，**字段名冻结**如下——

| 字段 | 类型 | 语义 |
|---|---|---|
| `name` | `string` | provider 名 |
| `description` | `string?` | provider 作者自述（未声明则键缺省） |
| `kind` | `string?` | 声明式 provider 的 item kind（imperative 无） |
| `priority` | `number?` | 同注册声明（未声明则键缺省） |
| `timeoutMs` | `number?` | 同注册声明（未声明则键缺省） |
| `mode` | `'always' \| 'once'` | 刷新模式（默认 `always` for imperative，声明式默认 `once`） |
| `sources` | `('prompt' \| 'touch')[]` | 信号源订阅；未声明 = `['prompt']` |
| `effectiveEnabled` | `boolean` | 双入口并集后的生效值，与 `run()` 执法口径一致 |
| `disabledBy` | `'user' \| 'config' \| 'both' \| null` | 禁用来源归属（`null` = 双开） |

约束：

- **只读**：本形状永不作写载荷。状态变更走窄命令——用户入口 `setDisabled()`，部署者入口 config `disabledProviders`。
- **投影源**：消费者（设置面、headless eval、诊断面）从本快照取子集，不各自拼接；`listViews()` 的视图是其历史投影，语义不变。
- **不含注册面**：`source`（imperative/declarative）是插件作者的接线细节，不进本快照的用户语义字段。
