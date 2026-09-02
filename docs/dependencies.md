---
description: extras 包的模块依赖拓扑与消费面对账——单包多行（C′ 形态）下模块间/包内库/对外基座三层依赖图，以及 exports 子路径与消费者的对账表（新增模块或对外基座时必过）
---

# 依赖拓扑与消费面

本包是单包多行载体：`modules/<m>/` 各为一个运行时独立的插件行（fiber），行间
不共享状态；依赖只发生在三个明确层面——模块间服务消费、模块内嵌纯库、
对外（包外插件/项目）消费面。本文是这三层拓扑的 SSOT。

## 模块依赖图

```text
@catheadowl/dsh-extras（根：server-only）
  ├─ modules/gates      质量门禁枢纽（无包内上游依赖）
  ├─ modules/markdown   自含链接事务库（模块内 src/links，无包内上游依赖）
  ├─ modules/prompt     自含 parse / tree 两个纯库（无包内上游依赖）
  ├─ modules/routes     ──服务消费──→ modules/prompt（ctx.promptMiddleware provider）
  ├─ modules/subagent   无包内依赖（用宿主 ctx.subagents）
  └─ modules/client     嵌套锚点包 @catheadowl/dsh-extras-client
                        （自有 manifest 声明 dsh.client；聚合 gates/prompt 的
                        Settings Tab 为单一 client bundle，根保持 server-only）

包外：
  coggit 插件 ──类型依赖──→ @catheadowl/dsh-extras/gates/register
               ──服务软依赖（ctx.inject(['gates'])，零 import）──→ gates 行
```

要点：

- **行间零源码依赖**：唯一的模块间关系是 routes 对 prompt 的 provider 注册
  （服务消费，prompt 行关闭时 routes 的 breadcrumb provider 静默不生效，
  不报错）；关掉任何一行，其余行行为不变。
- **纯库不出包**：markdown 的链接事务内核、prompt 的 parse/tree 库均为
  模块内嵌纯库，不预发布；出现第二个外部消费者时再按抽取规则独立成包。
- **client 面恰一个 source**：所有 Web UI 走嵌套锚点包，根 package.json
  不声明 `dsh.client`（宿主 client-modules「一包一源」不变量）。

## 消费面 × exports 对账（public contract 清单）

包的对外消费面（`exports` 子路径）与消费者对账——**新增模块或新增对外基座时
必须过这张表**（接线三处同改：`exports` + `scripts/verify-package-face.mjs`
的 SUBENTRIES / FACADE_EXPORTS + 所属模块 README；命名遵循模块前缀语法，
设计记录见原仓 ADR 0003）。

| 消费面 | 类别 | 消费者 | 状态 |
|---|---|---|---|
| `gates/register` | 基座注册面（`ctx.gates` 的硬 import 形态） | 其他插件（coggit） | ✓ |
| `prompt/register` | 基座注册面（`ctx.promptMiddleware` 的硬 import 形态） | 其他插件（结构类型软依赖亦可） | ✓ |
| `markdown/gate-check` | 配置面（`gates.yml` `module:` 回退） | 单仓项目配置 | ✓（niche，文档在 [modules/markdown](../modules/markdown/README.md)） |
| `gates` / `markdown` / `prompt` / `routes` | 组合行 loader 入口（行名 specifier） | cordis.patch.yml | ✓ |

非 exports 的对外协作形态（无需接线）：`ctx.gates` / `ctx.promptMiddleware`
service key 软依赖（`ctx.inject` 结构类型，零 import）。routes / subagent 无
对外基座（routes 是 prompt 的消费者；subagent 用宿主 `ctx.subagents`）。
