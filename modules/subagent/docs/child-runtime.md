---
description: subagent_at 子运行时（child runtime）的形态与配置——子代理是经 SDK client 公开启动面拉起的 dsh CLI 进程，组合由 profile/patches 表达；AGENTS.md 加载前提与凭证环境隔离
---

# 子运行时（child runtime）形态与配置

`subagent_at` 委派出去的每个子代理都是一个**独立的 dsh CLI 运行时进程**，
经 `@deepseek-ai/dsh-sdk-client` 的**公开启动面**拉起（`dshBin` + `profile` +
`patches` + `processCwd`/`cwd` + `env`）。宿主政策明文禁止公开面 spawn
任意 argv（`docs/architecture.md#application-launch`：package bins / demos /
public SDK argv escapes are forbidden），因此子运行时**只能是 dsh CLI**——
自定义组合通过 profile patch 层表达，而不是 `command`/`args` 指向任意可执行
文件（旧设计，已随宿主 `DeepSeekHarnessOptions.launch` 的移除作废，
档案 `docs/upstream-issues/20260901-1642-sdk-client-no-arbitrary-runtime-launch/`）。

## 契约：子运行时满足什么

1. **是 dsh CLI 运行时**：`dshBin` 省略时解析为 SDK client 的同版本依赖；
   指向另一个 dsh 安装（绝对或调用者相对路径）即"另一个版本的 dsh"。
   非 dsh 可执行文件（打包 exe、自定义 JSON-RPC server、跨语言子进程）
   不可表达。
2. **讲 SDK JSON-RPC 协议**：父端完成 `initialize` 握手、`session.run`
   投递、`session.event` 通知流、`shutdown` 交换。`profile` 选一个服务
   SDK 协议的 profile（默认 `sdk`——即宿主 `subagent-dsh-sdk` 同款通道）。
3. **进程由父端以 `cwd = 目标目录` 拉起**：`processCwd`（进程 cwd）与
   `cwd`（SDK 会话 workspace cwd）都由父端按调用注入，子运行时不需要、
   也不应该自带工作目录配置。
4. **组合经 `patches` 表达**：有序 per-launch profile patch 文件，相对
   路径在 spawn 前解析。想让子代理带特定扩展/工具/技能时，写一份 patch
   叠在所选 profile 上。
5. `dshHome` 可选：给子运行时一个隔离的 Harness home（会话持久化、
   设置、凭证都落在那里），不写则用默认 home。

## ⚠️ 关键事实：AGENTS.md 是否加载取决于子 profile 的组合

本插件的核心卖点（"子代理读目标目录的入口文件"）**不是父端插件实现的**，
而是靠：子进程以目标目录为 cwd 启动 → 子运行时组合里的
`@deepseek-ai/dsh-agent-instructions` 插件从会话 cwd 向上发现
`AGENTS.md` / `CLAUDE.md`。

因此**要卖点成立，子运行时的最终组合必须挂载 agent-instructions**。
默认 `sdk` profile 挂不挂以宿主当前版本为准——不挂时，写一份
`patches` 条目把 `@deepseek-ai/dsh-agent-instructions` 叠加进子组合。
子端是全新进程、上下文不继承父端（`inheritsParentContext=false`），
父会话加载的入口文件不会传给子端；也不存在「父端已加载、子端再挂会
double injection」一说。

## 配置字段与默认值

| 字段 | 默认 | 说明 |
|---|---|---|
| `dshBin` | （省略） | dsh CLI 模块路径；省略解析 SDK client 同版本依赖 |
| `profile` | `sdk` | 子运行时 profile（须服务 SDK 协议） |
| `patches` | `[]` | 有序 per-launch profile patch 文件（子组合的载体） |
| `dshHome` | （省略） | 子运行时隔离 Harness home |
| `provider` | `deepseek-official` | 子运行时 `initialize` 的模型路由 |
| `model` | `deepseek-v4-flash` | 子运行时 `initialize` 的模型 |
| `env` | `{}` | 子进程**完整**环境（`scrubbedParentEnv()` 打底再叠加显式项） |

拆除阶梯三超时（`shutdownTimeoutMs` / `disposeEofGraceMs` / `disposeGraceMs`）
直接透传 SDK client 公开选项，默认值与宿主一致。

## 凭证与环境隔离

- 子进程环境以 `scrubbedParentEnv()` 打底：父端的环境敏感名不会隐式
  泄漏给子代理；
- 需要带给子运行时的东西（凭证、`DSH_*` 事实）必须显式写进 `env`；
- 子运行时的会话持久化落在其 profile/home 决定的位置；默认 home 会写
  目标目录之外的默认位置，需要完全隔离时用 `dshHome` 指定。

## 与父端的关系（一图流）

```
父会话（工作区 X）
  └─ subagent_at(cwd: Y)
       ├─ 工具层：相对路径对 X 解析 → 绝对路径 → 校验存在性
       ├─ provider：assertUsableCwd(Y)
       └─ DeepSeekHarness({ dshBin?, profile, patches, processCwd: Y, cwd: Y, env: scrubbed + 显式 })
            └─ dsh CLI 子进程（profile + patch 组合）
                 ├─ SDK 会话 workspace cwd = Y
                 ├─ agent-instructions：从 Y 发现 AGENTS.md/CLAUDE.md（若组合挂载）
                 └─ stdout JSON-RPC ⇄ 父端 sdk-client（通知流 + 结算）
```
