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

配置速览如下；其中**子运行时（`command` / `args` / `env`）是最重要的
可配置项**——子代理是什么、读不读目标目录的入口文件，全由它的组合决定。
选型、契约与陷阱（含"官方示例组合不挂 agent-instructions"这个坑）
专门记录在 [docs/child-runtime.md](docs/child-runtime.md)。

| 配置项 | 默认 | 说明 |
|---|---|---|
| `providerName` | `dsh-sdk-at` | `ctx.subagents` 注册名 |
| `toolName` | `subagent_at` | 模型可见工具名 |
| `enableRunInBackground` | `true` | 是否暴露 `run_in_background` 参数（`false` 时省略参数并拒绝强制后台调用） |
| `command` / `args` | `node` / `[]`（占位） | 子运行时可执行文件与参数，详见 docs/child-runtime.md |
| `provider` / `model` | `deepseek-official` / `deepseek-v4-flash` | 子运行时初始化路由 |
| `env` | `{}` | 子进程追加环境变量 |
| `shutdownTimeoutMs` / `disposeEofGraceMs` / `disposeGraceMs` | 1000 / 6000 / 3000 | 拆除阶梯超时 |

当前随包默认值为占位（插件可正常加载注册；占位配置的失败形态是**挂住**
——裸 `node` 等 stdin、握手永不完成，表现为委派超时），按本机环境在
profile 的 patch 层覆盖即可。

## 构建与安装

```powershell
# 从插件目录构建（types + lib 一次产出）
pnpm run build        # = tsc -p tsconfig.json

# 装进 profile（裸路径 = link 语义；reconcile 自动 append 进 bundles）
dsh plugin --profile headless add D:/Document/Projects/dsh/dsh-plugin-dev/extras/modules/subagent

# 验证（分层，见 handbooks/dsh-plugin-dev/07 §3/§4.5）
dsh --profile headless --dump-config | findstr subagent-at
dsh --profile headless "Reply with exactly the single word: ok"
```

### 运行时 peer 解析（Windows junction）

`dsh plugin add` 裸路径是符号链接语义，Node 从插件真实目录向上找
`node_modules`，到不了宿主 `$DSH_HOME/profiles/node_modules` 的 fallback。
同一个解析层（插件 `node_modules/@deepseek-ai/`）要覆盖**两类**需求：

1. 插件自身 import 的 8 个运行时包（`@deepseek-ai/dsh-jobs` 仅 type-only
   import，不增加运行时 junction 需求——配方同
   `handbooks/dsh-plugin-dev/07` §2.3 坑 3）；
2. **子运行时组合 `child-runtime/cordis.yml` 引用的全部包**（约 18 个，
   含传递入口如 `dsh-sdk-jsonrpc-server` / `dsh-agent-instructions` 等）——
   因为组合里 bare 包名的解析锚点是组合所在目录，不是子进程 cwd，
   详见 [docs/child-runtime.md](docs/child-runtime.md) 的实测坑节。

完整映射与一键脚本见 `../_scratch/junction-child-runtime-deps.mjs`（开发
环境，已 gitignore）：

```powershell
node ../_scratch/junction-child-runtime-deps.mjs   # 从 dsh-plugin-dev/extras/modules/subagent 运行也行，路径是绝对的
```

## 测试与 eval

```powershell
pnpm test        # node:test 单元测试（跑编译后 lib/，含措辞对齐的 drift guard）
pnpm eval        # behavior real：双工具路由意图（需 profile 已装插件 + 凭证）
pnpm eval:mock   # behavior mock：空 cwd 校验 fail loud（无需 API key）
```

单元测试覆盖：双注册、provider 契约、**描述与宿主 `tool-subagent` 逐字对齐 +
仅追加 cwd 提示**（drift guard，含 background 后缀两种变体）、相对/绝对/空
`cwd` 槽位语义、`run_in_background` 后台路由（jobs seam 注册/驱动/取消/
无 seam fail loud）、失败路径。
case 清单与前置见 [eval/README.md](eval/README.md)。

**已验证（本机，2026-08-22）**：单元 17/17；mock 1/1；real 意图 2/2（含双工具
同屏路由）；端到端暗号取证通过——子代理在目标目录启动、会话持久化落在目标目录、
且读到了该目录的入口文件（`CLAUDE.local.md` 暗号原样回传）。

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
| `child-runtime/cordis.yml` | 随包子运行时组合（示例组合 + `agent-instructions`，v1 推荐） |
| `docs/child-runtime.md` | 子运行时选型、契约与配置详解 |
| `test/` | node:test 单元测试（跑编译产物） |
| `eval/` | behavior case（real 意图路由 / mock 校验），基于 `dsh-plugin-dev/eval` 框架 |
