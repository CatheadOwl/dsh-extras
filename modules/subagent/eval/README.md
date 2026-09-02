---
description: subagent-at eval 的 case 清单与运行方式——real 层验证双工具意图路由（同工作区选原生 subagent / 跨目录选 subagent_at），mock 层锁定 fail-loud 路径与顶层 system-prompt section 注入
---

# subagent-at eval

框架与规则以 `dsh-plugin-dev/eval/`（开发仓库 dsh-plugin-dev/eval/README.md，纯文本引用） 为准；
本目录只放本插件的 case。

## 前置

所有 behavior case 都要求 **插件已装进被启动的 profile**（默认 `headless`）
且插件配置可用：

```powershell
dsh plugin --profile headless add D:/Document/Projects/dsh-extra/dsh-plugin-dev/extras/modules/subagent
```

子运行时组合（profile/patches）按
[模块 README 配置节](../README.md#配置) 配置：

- **mock** 与 **意图选择断言**不受子运行时组合影响（脚本化调用/只断言
  `tool/call`）；
- 端到端委派（子代理真的跑起来）需要子 profile 组合就绪
  （默认 `sdk` profile，或 patches 叠加 agent-instructions 等）。

## Case 清单

| case | 层 | 验证什么 |
|---|---|---|
| `behavior/real/intent-same-workspace` | real | 双工具可见时，同工作区委派稳定选原生 `subagent`，不误入 `subagent_at` |
| `behavior/real/intent-cross-directory` | real | 明确指向其它目录的任务选 `subagent_at` 且 `cwd` 槽位非空 |
| `behavior/mock/cwd-validation` | mock | 空 `cwd` 走真实工具管线时 fail loud（无需 API key） |
| `behavior/mock/system-prompt-section` | mock | 顶层 system-prompt section 注入锁定：`request/header.system` 含 `subagent_at` 引导段 + `header.tools` 挂载该工具（无需 API key） |

前两条正是"模型看到两个 subagent 会不会疑惑"的行为验证：一条负向
（不该选它时不选），一条正向（该选它时选它且填槽）。mock 两条是确定性
回归：一条锁 fail-loud 路径，一条锁顶层 section 注入（配套 matcher
`systemPromptIncludes` / `toolMounted` 在 `dsh-plugin-dev/eval` 框架）。

## 已知断言缺口

1. **意图断言的假阳性**：子进程失败时错误回流为工具结果、turn 照常 exit 0，
   意图断言照过（见 `handbooks/Gremlins/20260822-1521-*` 经验 2）。
   端到端结果内容不在本目录断言，由人工暗号取证覆盖（插件 README "已验证"节）。

## 运行

```powershell
# 从插件目录
node ../../eval/bin/dsh-eval.mjs run --profile headless --repo ../../deepseek-harness eval/behavior/real
node ../../eval/bin/dsh-eval.mjs run --profile headless --repo ../../deepseek-harness --mode mock eval/behavior/mock
```

real 层需要 `DEEPSEEK_API_KEY` 或 `$DSH_HOME/.credentials.yaml`；mock 不需要。
注意 `intent-same-workspace` 会真实拉起一个 in-process 子代理（多一次模型
调用），任务已保持最小。
