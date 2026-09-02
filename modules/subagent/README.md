---
description: 目录定向 subagent 委派插件（subagent_at 工具 + dsh-sdk-at provider）：子代理在目标目录启动并加载其入口文件；支持前台与 run_in_background 后台两种一次性委派
---

# subagent-at

目录定向的 subagent 委派插件：一个 `subagent_at` 工具 + 一个进程外
`dsh-sdk-at` provider。子代理是一个**在目标目录里启动的完整 dsh 运行时
独立进程**——其会话工作区即目标目录，因此会加载该目录的 `AGENTS.md` /
`CLAUDE.md` 入口文件，等价于"在目标文件夹启动的 agent"。

本 README 是随包发布的**使用文档**。设计决策、规格、路线图与开发侧的构建 /
测试 / 验证在开发仓库的 subagent-at 工作单元（外层仓库，不随包发布，纯文本
引用）；这里只保留插件本体叙事、契约与使用说明。

## 与原生 `subagent` 的分工

| 工具 | 意图 |
|---|---|
| `subagent` / `subagent_fork`（原生） | 当前工作区内的上下文隔离委派（默认路径） |
| `subagent_at`（本插件） | 跨目录/跨项目委派，子代理按目标文件夹身份启动（条件路径） |

工具描述写明了互斥触发条件：任务**需要在另一个目录/项目上下文执行**时用
`subagent_at`，同工作区子任务一律用原生 `subagent`。插件还为模型注册顶层路由
提示（与宿主"每个委派工具一个引导段"的做法对齐）：以价值开头（子代理在目标
目录启动并复用其入口文件与项目约定），再写触发条件与同工作区回退；提示措辞与
工具描述保持同一路由真相。

## 行为契约（对齐宿主 `subagent-dsh-sdk`）

- `NO_START_CAPABILITIES`：`outputSchema` / `maxDepth` / `toolFilter` /
  `persona` 一概拒绝，服务层在 `start` 前 fail loud；
- `inheritsParentContext = false`：子代理全新启动，不继承父对话；
- 子运行时当前固定叠加内置 `read-only` sandbox overlay；`subagent-at` 先作为
  只读检视器使用，权限放开留到后续交互线；
- **每次 `start` 校验 cwd**（绝对、存在、可进入），失败直接抛——不静默回落
  父会话 cwd（与宿主 `Config.cwd` 静态覆盖的关键差异：工作区是运行时事实，
  不抬进配置，本插件刻意不提供静态路径配置）；
- 环境以 `scrubbedParentEnv()` 打底 + Config `env` 显式叠加；
- 有界拆除阶梯：`shutdown` 交换 → EOF grace → 信号 grace（三超时均可配）。

## 配置

配置速览如下；其中**子运行时组合（`profile` / `patches` / `dshHome`）是最重要的
可配置项**——子代理是什么、读不读目标目录的入口文件，全由它的组合决定。
组合怎么配、陷阱在哪，见下节「子运行时机制要点」。

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

### 子运行时机制要点（自包含）

- **子代理是一个独立 dsh CLI 进程**，经 `@deepseek-ai/dsh-sdk-client` 公开启动面
  拉起（`dshBin + profile + patches + processCwd/cwd + env`）。宿主只允许经
  `dsh` profile 启动 Node 应用（宿主 AGENTS.md「Application launch」规则），
  公开面没有任意 argv 通道——旧版 `command`/`args`（指向任意 JSON-RPC bin /
  打包 exe）已随宿主移除 `DeepSeekHarnessOptions.launch` 作废（上游档案
  `20260901-1642-sdk-client-no-arbitrary-runtime-launch`，开发仓库纯文本引用）。
- **组合 = 所选 profile + 有序 per-launch `patches`**（相对路径 spawn 前解析）。
  「子代理读目标目录的 `AGENTS.md`/`CLAUDE.md`」不是父端实现的：子端是全新进程
  （`inheritsParentContext=false`），入口文件由子组合里挂载的
  `@deepseek-ai/dsh-agent-instructions` 从会话 cwd 向上发现。要卖点成立，子组合
  必须挂它——默认 `sdk` profile 当前宿主组合（base + sdk-app）已挂；换用不含它
  的 profile 时，写一条 `patches` 把它加进子组合即可。
- **凭证与环境隔离**：子进程环境以 `scrubbedParentEnv()`（宿主
  `@deepseek-ai/dsh-subprocess` 共享实现）打底——凭证形与 `DSH_*` 名不隐式泄漏，
  需要带进子运行时的凭证/`DSH_*` 事实显式写 `env`。

## 安装

本模块随 `@catheadowl/dsh-extras` 发布：

```powershell
dsh plugin --profile <profile> add @catheadowl/dsh-extras
```

组合行 id 是 `subagent-at`（宿主 dsh-base 已占用 `subagent`）。不需要本模块时，
在 profile patch 层对该行写 `disabled: true` 即可单关。

## 已知限制

- 一次性委派：不支持 continuable / `send_message` 多轮——宿主进程外 provider
  无 `prepareContinuable` 的能力缺口，非本插件差异；
- 默认只读：子运行时固定叠加内置 `read-only` sandbox overlay；
- 无父端子代理血缘展示：进程外子会话不进父端 session store（官方 `dsh-sdk`
  provider 同样如此，非本插件差异）。
