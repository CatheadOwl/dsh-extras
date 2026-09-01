---
description: subagent_at 子运行时（child runtime）的选型与配置——子代理是独立 dsh 运行时进程的契约、候选组合、AGENTS.md 加载前提与凭证环境隔离
---

# 子运行时（child runtime）选型与配置

`subagent_at` 委派出去的每个子代理都是一个**独立的 dsh 运行时进程**。
这个进程"是什么"完全由 `command` / `args` / `env` 决定——它是本插件
最重要的可配置项：父端插件只负责在目标目录里把它拉起来并走协议，
子代理装载什么模型路由、什么工具、什么扩展、读不读入口文件，
全部取决于子运行时的组合（cordis 配置）。

## 契约：子运行时必须满足什么

1. **讲 SDK JSON-RPC 协议**（`@deepseek-ai/dsh-sdk-protocol`）：
   父端经 `@deepseek-ai/dsh-sdk-client` 完成 `initialize` 握手、
   `session.run` 投递、`session.event` 通知流、`shutdown` 交换。
   实操上就是组合里挂载 `@deepseek-ai/dsh-sdk-jsonrpc-server`。
2. **stdout 专属协议**：子运行时不能挂 console logger / 终端 UI /
   任何往 stdout 写非协议内容的插件（权威约束见宿主
   `examples/jsonrpc-agent/cordis.yml` 顶部注释）。
3. **进程由父端以 `cwd = 目标目录` 拉起**：父端插件按调用注入，
   子运行时**不需要也不应该**自带工作目录配置。其 SDK 会话的工作区
   cwd 由父端 `DeepSeekHarness` 的 cwd 选项写入——两者都指向目标目录。
4. 配置路径经 `args`（positional）或 `env.DSH_CORDIS_CONFIG` 指定。

## 候选运行时

| 候选 | 出处 | 形态 | 备注 |
|---|---|---|---|
| **随包组合（v1 推荐）** | `child-runtime/cordis.yml`（本插件目录） | 配置样例 | 示例组合；`agent-instructions` 默认未挂（加回条件见该文件注释）；配 `dsh-jsonrpc-agent` bin 使用 |
| `dsh-jsonrpc-agent` bin | `@deepseek-ai/dsh-sdk-jsonrpc-demo`（`deepseek-harness/packages/examples/jsonrpc-demo`，bin = `lib/bin.js`） | Node bin 或打包 exe | 官方无值守 JSON-RPC 运行时；打包 exe 目标机器无需 Node |
| `examples/jsonrpc-agent` 组合 | `deepseek-harness/examples/jsonrpc-agent/`（`cordis.yml` + `minimal.cordis.yml`） | 配置样例 | 原始样例，**未挂** agent-instructions，直接用不读入口文件 |
| 自定义组合 | 你自己写的 `cordis.yml` | 任意 | 想让子代理带特定扩展/工具/技能时的正路——子运行时就是一个完整 dsh 部署 |

配置加载契约（`dsh-jsonrpc-agent` 的 runner）：`DSH_CORDIS_CONFIG` 环境变量
优先于 argv[2]，配置必填无内建回落；由于子进程以目标目录为 cwd，
相对路径会错位——**一律用绝对路径**（建议经父端插件 `env.DSH_CORDIS_CONFIG`
传入，`command`/`args` 保持干净的 bin 形态）。
本仓库的验证样例见 `dsh-plugin-dev/_scratch/subagent-at-local.patch.yml`。

## ⚠️ 关键事实：AGENTS.md 是否加载取决于子运行时的组合

本插件的核心卖点（"子代理读目标目录的入口文件"）**不是父端插件实现的**，
而是靠：子进程以目标目录为 cwd 启动 → 子运行时的
`@deepseek-ai/dsh-agent-instructions` 插件从会话 cwd 向上发现
`AGENTS.md` / `CLAUDE.md`（根标记默认 `.git`，沿祖先链逐目录加载）。

因此**要卖点成立，子运行时必须挂载 `@deepseek-ai/dsh-agent-instructions`**。
注意官方示例组合 `examples/jsonrpc-agent/cordis.yml` **没有**挂它
（其 `agent-spine-demo` 还设了 `workspaceContext: false`、skills 关闭）——
直接拿示例组合用，子代理不会加载任何入口文件。要卖点成立，给子运行时
一份追加了该插件的组合（或直接用一个带完整上下文装载的部署）。

⚠️ 子端是全新进程、上下文不继承父端（`inheritsParentContext=false`），父会话
加载的入口文件不会传给子端——子端要遵循目标目录的入口文件，只能靠它自己的
agent-instructions，不存在「父端已加载、子端再挂会 double injection」一说。
随包组合 `child-runtime/cordis.yml` 为省 token **默认未挂** agent-instructions
（加回条件见该文件注释）；目标目录 ≠ 父工作区、需要子端独立加载目标目录指令时，
把它加回。

## ⚠️ 实测坑：组合所在目录必须有 `@deepseek-ai/*` 解析层

子进程的**进程 cwd 是目标目录**，但组合里 bare 包名（`name: '@deepseek-ai/...'`）
的 import 解析锚点是**组合文件所在目录**向上找 `node_modules`（实测报错：
`Cannot find package '@deepseek-ai/dsh-sdk-jsonrpc-server' imported from <组合目录>`）。
组合放在插件目录时，需要把组合引用的**全部** `@deepseek-ai/*` 包 junction 进
插件自己的 `node_modules/@deepseek-ai/`（不只插件自己 import 的那几个；
传递依赖经 junction 目标的真实目录走宿主 pnpm 包图自行解析）。映射清单与
一次性脚本见插件 `README` 的 junction 节与 `_scratch/junction-child-runtime-deps.mjs`。
若把组合放进宿主检出内（如 `examples/` 旁），则天然命中宿主包图，无需此层。
完整排障记录：`handbooks/Gremlins/20260822-1521-subagent-at-composition-resolution.md`；
占位配置的挂住形态见姊妹篇 `20260822-1520-subagent-at-placeholder-hang.md`（同目录）。

## 配置字段与默认值

| 字段 | 默认 | 说明 |
|---|---|---|
| `command` | `node`（**占位**） | 子运行时可执行文件：`dsh-jsonrpc-agent` bin、打包 exe、或 `node` + 入口脚本 |
| `args` | `[]`（**占位**） | 传给 `command` 的参数（通常是子运行时 `cordis.yml` 路径） |
| `provider` | `deepseek-official` | 子运行时 `initialize` 的模型路由 |
| `model` | `deepseek-v4-flash` | 子运行时 `initialize` 的模型 |
| `env` | `{}` | 叠加在 `scrubbedParentEnv()` 之上的子进程环境变量（如 `DSH_CORDIS_CONFIG`、子运行时自己的 `DEEPSEEK_API_KEY`） |

**当前状态：`cordis.patch.yml` 里是占位默认值**（`node` + 空 args）。
注意占位配置的失败形态是**挂住**（裸 `node` 无参数会等 stdin，握手永不完成，
表现为委派超时）而非立即报错；真用之前必须在 profile 的 patch 层覆盖。

## 凭证与环境隔离

- 子进程环境以 `scrubbedParentEnv()` 打底：父端的环境敏感名不会隐式
  泄漏给子代理；
- 需要带给子运行时的东西（凭证、`DSH_CORDIS_CONFIG`、`DSH_MODEL` 等）
  必须显式写进 `env`；
- 子运行时的会话持久化落在它自己的组合配置处（示例组合默认
  `./.sessions`，即目标目录下的相对路径——注意这会写进目标目录，
  必要时用 `DSH_SESSION_ROOT` 移走）。

## 与父端的关系（一图流）

```
父会话（工作区 X）
  └─ subagent_at(cwd: Y)
       ├─ 工具层：相对路径对 X 解析 → 绝对路径 → 校验存在性
       ├─ provider：assertUsableCwd(Y)
       └─ spawn(command, args, { cwd: Y, env: scrubbed + 显式 })
            └─ 子运行时进程（独立 cordis 组合）
                 ├─ SDK 会话 workspace cwd = Y
                 ├─ agent-instructions：从 Y 发现 AGENTS.md/CLAUDE.md（若挂载）
                 └─ stdout JSON-RPC ⇄ 父端 sdk-client（通知流 + 结算）
```
