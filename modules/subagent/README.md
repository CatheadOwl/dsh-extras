---
description: 目录定向 subagent 委派插件（subagent_at 工具 + dsh-sdk-at provider）：子代理在目标目录启动并加载其入口文件；支持前台与 run_in_background 后台两种一次性委派
---

# subagent-at

目录定向的 subagent 委派插件：一个 `subagent_at` 工具 + 一个进程外
`dsh-sdk-at` provider。子代理是一个**在目标目录里启动的完整 dsh 运行时
独立进程**——其会话工作区即目标目录，因此会加载该目录的 `AGENTS.md` /
`CLAUDE.md` 入口文件，等价于"在目标文件夹启动的 agent"。

设计讨论与决策记录见
`docs/meeting-room/20260822-1347-subagent-cwd-plugin/`（尤其
`plan-1-设计决策记录.md` 与 `plan-2-实现清单.md`）。

## 与原生 `subagent` 的分工

| 工具 | 意图 |
|---|---|
| `subagent` / `subagent_fork`（原生） | 当前工作区内的上下文隔离委派（默认路径） |
| `subagent_at`（本插件） | 跨目录/跨项目委派，子代理按目标文件夹身份启动（条件路径） |

工具描述里写明了互斥触发条件，模型按"是否需要另一个目录的项目上下文"选择。

## 模型面引导（顶层 system-prompt section）

插件为 `subagent_at` 注册一个顶层 system-prompt section（`tool:subagent_at`，
order 116.6，紧随宿主 `tool-subagent` 的 116.5 引导、在 `coggit:overview`(117)
之前）——与宿主"每个委派工具一个引导段"的做法对标。文本**以价值开头**（子代理
在目标目录启动并**复用其上下文**：入口文件 `AGENTS.md`/`CLAUDE.md` 与项目约定），
再写触发条件（跨目录/跨项目）与同工作区回退（用原生 `subagent`）；刻意**不照搬**
宿主 "background by default" 措辞——那是 continuable 语义，本工具是一次性委派、
默认前台。措辞与工具描述里的 `DIRECTORY_TARGET_HINT` 保持同一路由真相
（描述 = schema 侧契约，section = 顶层心智模型），见
workunits/subagent-at/spec/0001-system-prompt-section.md（开发仓库 workunits/subagent-at/spec/0001-system-prompt-section.md，纯文本引用）。

## 行为契约（对齐宿主 `subagent-dsh-sdk`）

- `NO_START_CAPABILITIES`：`outputSchema` / `maxDepth` / `toolFilter` /
  `persona` 一概拒绝，服务层在 `start` 前 fail loud；
- `inheritsParentContext = false`：子代理全新启动，不继承父对话；
- **每次 `start` 校验 cwd**（绝对、存在、可进入），失败直接抛——
  不静默回落父会话 cwd（与宿主 `Config.cwd` 静态覆盖的关键差异：
  工作区是运行时事实，不抬进配置，本插件刻意不提供静态路径配置）；
- 环境以 `scrubbedParentEnv()` 打底 + Config `env` 显式叠加；
- 有界拆除阶梯：`shutdown` 交换 → EOF grace → 信号 grace（三超时均可配）。

## Seam 开放性标注（重要）

`SubagentStartRequest`（宿主契约）**没有** `cwd` 字段。本插件利用
`SubagentRuntime.start()` 的行为——它只校验四个已知能力字段，然后
`{ ...request, descriptor }` 浅展开通传——由插件自己的工具挂入 `cwd`、
自己的 provider 读出（`AtStartRequest` 扩展类型声明在插件边界内）。

这是对 subagent 注册表"多 provider 共存"开放性的正规利用，不是绕过宿主
逻辑的 workaround。**毕业路径**（若将来提 upstream）：

1. `SubagentStartRequest` 增可选 `cwd`；
2. `SubagentCapabilities` 增 `workspace` 能力位（对仗 `depthLimit`）；
3. `tool-subagent` 参数面暴露 `cwd`，按能力位路由；
4. 官方 provider 的 `resolveChildCwd` 优先级改为 调用值 > Config > 父会话。

届时本插件的 `AtStartRequest` 退回官方契约即可，其余代码基本不动。

## 配置

配置速览如下；其中**子运行时组合（`profile` / `patches` / `dshHome`）是最重要的
可配置项**——子代理是什么、读不读目标目录的入口文件，全由它的组合决定。
选型、契约与陷阱专门记录在 [docs/child-runtime.md](docs/child-runtime.md)。

| 配置项 | 默认 | 说明 |
|---|---|---|
| `providerName` | `dsh-sdk-at` | `ctx.subagents` 注册名 |
| `toolName` | `subagent_at` | 模型可见工具名 |
| `enableRunInBackground` | `true` | 是否暴露 `run_in_background` 参数（`false` 时省略参数并拒绝强制后台调用） |
| `dshBin` | （省略） | dsh CLI 模块路径；省略解析 SDK client 同版本依赖 |
| `profile` | `sdk` | 子运行时 profile（须服务 SDK 协议） |
| `patches` | `[]` | 有序 per-launch profile patch 文件（子组合的载体） |
| `dshHome` | （省略） | 子运行时隔离 Harness home |
| `provider` / `model` | `deepseek-official` / `deepseek-v4-flash` | 子运行时初始化路由 |
| `env` | `{}` | 子进程完整环境（`scrubbedParentEnv()` 打底 + 显式叠加） |
| `shutdownTimeoutMs` / `disposeEofGraceMs` / `disposeGraceMs` | 1000 / 6000 / 3000 | 拆除阶梯超时（透传 SDK client 公开选项） |

子运行时经 SDK client **公开启动面**拉起（`dshBin + profile + patches +
processCwd/cwd + env`）。宿主政策禁止公开面 spawn 任意 argv
（`docs/architecture.md#application-launch`），故旧版 `command`/`args`
（指向任意 JSON-RPC bin / 打包 exe）已不可表达、字段已移除；背景与档案见
[docs/child-runtime.md](docs/child-runtime.md)。

## 构建与安装

```powershell
# 从插件目录构建（types + lib 一次产出；模块无独立 package.json，直接 tsc）
npx tsc -p tsconfig.json

# 装进 profile（裸路径 = link 语义；reconcile 自动 append 进 bundles）
dsh plugin --profile headless add D:/Document/Projects/dsh-extra/dsh-plugin-dev/extras/modules/subagent

# 验证（分层，见 handbooks/dsh-plugin-dev/07 §3/§4.5）
dsh --profile headless --dump-config | findstr subagent-at
dsh --profile headless "Reply with exactly the single word: ok"
```

### 运行时 peer 解析（模块级 junction 层）

`dsh plugin add` 裸路径是符号链接语义，Node 从插件真实目录向上找
`node_modules`，到不了宿主 `$DSH_HOME/profiles/node_modules` 的 fallback。
模块需要一层**自己的** `node_modules/@deepseek-ai/` junction，覆盖插件
自身 import 的运行时包（`cordis` / `schemastery` / `dsh-tools` /
`dsh-llm` / `dsh-session` / `dsh-subagent` / `dsh-subprocess` /
`dsh-sdk-client` / `dsh-util-values`；`dsh-jobs` 仅 type-only import）。
junction 目标取宿主检出（`apps/cli/node_modules/@deepseek-ai/*`；包图中
没有的——`dsh-sdk-client` / `dsh-util-values`——直接指 `packages/*` 包目录）。

旧版还需把**子运行时组合**引用的全部包 junction 进来（约 18 个，含
传递入口如 `dsh-sdk-jsonrpc-server` / `dsh-agent-instructions`）——改造后
**不再需要**：子进程是 dsh CLI，由 SDK client 按它自己的包图解析，
解析锚点不再落在插件目录。

## 测试与 eval

```powershell
node --test test/plugin.test.mjs          # 单元测试（跑编译后 lib/）
node eval/behavior/mock/cwd-validation.eval.mjs        # mock：空 cwd 校验 fail loud（无需 API key）
node eval/behavior/mock/system-prompt-section.eval.mjs # mock：工具挂载 + system-prompt section
node eval/behavior/real/intent-cross-directory.eval.mjs   # real：双工具路由意图（需 profile 已装插件 + 凭证）
```

单元测试覆盖：双注册、provider 契约、**描述与宿主 `tool-subagent` 逐字对齐 +
仅追加 cwd 提示**（drift guard，含 background 后缀两种变体）、相对/绝对/空
`cwd` 槽位语义、`run_in_background` 后台路由（jobs seam 注册/驱动/取消/
无 seam fail loud）、失败路径。
case 清单与前置见 [eval/README.md](eval/README.md)。

**已验证（本机，2026-09-01，公开面改造后）**：tsc 全绿、lib 重建；单元 19/19；
mock eval 2/2（真实 headless 管线：空 cwd fail loud、工具挂载 + system-prompt
section）。真模型 e2e：直连探针（与 `run.ts` 同参，含 scrub 环境 + 命名 session
+ 三超时）5.3s 全程跑通（握手 → 子会话真模型调用 → 干净拆除）；经 headless
真模型委派的三次运行，子会话均**落在目标目录的 sessions 区**（核心卖点的
持久化证据）。尚未拿到干净的 real 意图 eval 通过件：staged home 下
`REQUEST_EXTENSION` 已知问题拦在首个模型调用（见
`workunits/eval/TODO/20260901-staged-home-request-extension.md`）；真模型 e2e
的 turn 收尾被 doc-link 门在宿主检出上的预存断链阻塞（表象即挂死，坑档案
`handbooks/Gremlins/20260901-2245-gated-profile-e2e-doclink-archived-storm.md`）——
验证性运行应禁 gates 行或换无关 cwd。旧版（launch 面，2026-08-22）的端到端
暗号取证（子代理读到目标目录入口文件）需按新通道重取证。

## v1 范围（显式收窄）

- ✅ 前台一次性委派：等待结果、stop reason 映射、失败保留部分输出；
- ✅ 后台一次性委派：`run_in_background: true` 走宿主 jobs seam（`ctx.get('jobs')`），
  注册归父 agent 所有的 Task 并返回 job id（`job_output` 收集 / `job_kill` 停止），
  与原生 `tool-subagent` one-shot 后台路由同构；子代理进程在 job `run()` 驱动时才启动；
- ❌ continuable / `send_message` 多轮（需要 `prepareContinuable` + 持久化）；
- ❌ 父端子代理血缘展示（进程外子会话不进父端 session store；
  官方 `dsh-sdk` provider 同样如此，非本插件差异）。路线 A 设计已记录于
  meeting-room plan-3（开发仓库 docs/meeting-room/20260822-1347-subagent-cwd-plugin/，纯文本引用）
  （宿主 seam 扩展：`SubagentProvider.listChildren?` 钩子 + 本插件运行中台账，
  复用原生 `subagent.list` 数据面），未实现。

## 源码与文档结构

| 文件 | 职责 |
|---|---|
| `src/index.ts` | 函数式插件：双注册 + 工具（槽位解析/前台与后台结算） |
| `src/provider.ts` | `AtSdkSubagentProvider`（per-call cwd 校验） |
| `src/run.ts` | 进程驱动胶水（仿宿主 `subagent-dsh-sdk/src/run.ts`） |
| `src/types.ts` | `AtStartRequest` 扩展契约 + Config |
| `docs/child-runtime.md` | 子运行时形态、契约与配置详解 |
| `test/` | node:test 单元测试（跑编译产物） |
| `eval/` | behavior case（real 意图路由 / mock 校验），基于 `dsh-plugin-dev/eval` 框架 |
