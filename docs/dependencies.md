---
description: extras 包的依赖拓扑与消费面对账——先校准 dsh 宿主里「依赖」的真实语义（服务键/inject/基座承载，而非 npm 依赖），再分四层给出模块关系：宿主接缝消费、自声明服务基座（gates/prompt 承载其他插件的功能）、行间关系、模块内嵌纯库；附 exports 消费面对账表
---

# 依赖拓扑与消费面

本包是单包多行载体：`modules/<m>/` 各为一个运行时独立的插件行（fiber）。
要画清这个包的「依赖图」，先要校准宿主（dsh）里**「依赖」不是 npm 依赖**——
插件间的功能承载发生在 Cordis 运行时的服务接缝上，与包管理器无关。
本文按四层展开，最后一节是 exports 消费面对账。

## 0. 语义底座：宿主运行时里的「依赖」

dsh 是微内核 harness：插件在 Cordis fiber 树上运行，能力以**服务键
`ctx.<key>`** 表达——提供方用 Service 子类构造时认领键（随 fiber 装载/卸载），
消费方用 `inject` / `ctx.inject(['<key>'], cb)` 声明依赖。要点：

- **依赖的解析发生在 boot 期**：Cordis 按 fiber 拓扑解析服务键，与 npm 解析
  无关。消费方**从不 import 提供方包**（软依赖：结构类型 + 条件注入，
  提供方缺席时回调不触发、消费方软降级）。
- **任何插件都能自声明服务键**（不只宿主）。自声明 + 被其他插件消费的插件，
  就是下面说的「基座」。
- 本包所有行的**运行时依赖由 dsh 宿主以 peerDependencies 提供**；包自身
  npm `dependencies` 只有少量纯 JS 工具库。所以本包的「依赖图」大部分
  边不是 npm 边，而是宿主接缝边。

## 1. 宿主接缝消费（每一行都是宿主服务的 consumer）

| 行 | 消费的宿主接缝 |
|---|---|
| gates | `ctx.tools`（`gates_run`）、`agent/turn-stopping` 检查点（轮末阻塞驱动）、命令/技能注册面 |
| markdown | `ctx.tools`（`md_rename`）、`agent/turn-stopping`（doc-link gate 的 defer 档旁路） |
| prompt | `agent/pre-step` 检查点（driver 挂载点）、Typert Remote / Web 配置面 |
| routes | `ctx.tools`（`any_routes`）+ prompt 基座（见 §2）；扫描根取自 `agent.session.header.cwd` |
| client（锚点包） | Web 插槽（`settings.plugins.tab`）——聚合 §2 两个基座的 Settings Tab |

这些边**朝向宿主**，随 dsh base bundle 提供，不在本包的依赖记账范围。

## 2. 自声明服务基座：其他插件的功能「承载」在 gates / prompt 身上

gates 与 prompt 是本包的两个**基座行**（自声明 Definition + 自实现 Provider，
折叠在同一行内）：它们各自认领一个服务键并提供一份**执行骨架**，其他插件的
功能作为注册项**承载**在这两个骨架上运行——这不是「谁依赖谁」的模块关系，
而是「别人的功能在这里落脚」的承载关系（箭头方向 = 功能流向基座）：

```text
ctx.gates（gates 行认领）              ctx.promptMiddleware（prompt 行认领）
  执行骨架：注册表 + 轮末触发            执行骨架：agent/pre-step driver +
  + 预算/超时/反馈/remedy                once 账本 + 聚合/预算/渲染
      ▲ 注册 gate                           ▲ 注册 provider
      │                                      │
  coggit 插件（coggit-misplaced）         routes 行（breadcrumb 面包屑注入）
                                         coggit 插件（cognition-link 注入）
```

承载侧的三种声明形态（软→硬谱系，均**不构成对基座的编译依赖**）：

| 形态 | 做法 | 例子 |
|---|---|---|
| 软依赖（典型） | `ctx.inject(['<key>'], cb)` 条件注入 + 本地结构类型镜像；基座缺席则软降级 | coggit 对 `ctx.gates`、`ctx.promptMiddleware` |
| 硬 import 注册入口 | 消费方 import 基座的 `register` 子路径（见 §5 对账表），内部仍走软依赖接线 | coggit 的类型依赖 `gates/register`；provider 注册入口 `prompt/register` |
| 声明式注册面 | 只写 `resolve` + `kind`，框架物化为 provider 并复用整套骨架 | routes 的 breadcrumb（`registerRelates`） |

配套约束：

- **注册必须 return disposer**——基座注册表是纯 Map，disposer 是唯一回滚通道。
- **基座行关闭时承载方软降级**：不装 gates 时 coggit 照常工作（少一个 gate）；
  不装 prompt 行时 routes 的 breadcrumb 注入静默不生效（`any_routes` 不受影响）。
- 基座自己也消费宿主接缝（§1），且**不内置业务逻辑**：gates/prompt 只实现
  承载层，cognition、面包屑等业务都在承载方。
- gates 另有一条**配置面承载**：仓库级 `gates.yml` 的 `module:` 形态可把
  本包 markdown 行的 `gate-check` 作为外部模块物化为 gate——项目功能承载在
  gates 执行骨架上，但既非插件注册也非 npm 依赖。

## 3. 行间关系（包内）

除 §2 的承载关系（routes→prompt）外，行间**零源码依赖、零共享状态**：
关掉任何一行，其余行行为不变。这是「单包多行」的发布形态基础——每行独立
fiber、按行 id 单关、模块上下架走包版本更新。

## 4. 模块内嵌纯库（原独立库吸收）

基座行与工具行各内嵌不发布的纯库——它们是**包内折叠**，不是依赖边：

| 所属模块 | 内嵌库 | 职责 |
|---|---|---|
| markdown | `src/links` | 链接事务内核（`md_rename` 工具与 doc-link gate 共享同一份链接算法——单拷贝不变量：vendor 两份即两个漂移点） |
| prompt | `src/parse` | fuzzy/parse/resolve 纯库（路径引用解析） |
| prompt | `src/tree` | gitignore-aware 工作区枚举 |

抽取规则：被吸收的库不预发布；出现第二个**外部**消费者时再独立成包。

## 5. 消费面 × exports 对账（public contract 清单）

包的对外消费面（`exports` 子路径）与消费者对账——**新增模块或新增对外基座时
必须过这张表**（接线三处同改：`exports` + `scripts/verify-package-face.mjs`
的 SUBENTRIES / FACADE_EXPORTS + 所属模块 README；命名遵循模块前缀语法，
设计记录见原仓 ADR 0003）。

| 消费面 | 类别 | 消费者 | 状态 |
|---|---|---|---|
| `gates/register` | 基座注册面（`ctx.gates` 的硬 import 形态） | 其他插件（coggit） | ✓ |
| `prompt/register` | 基座注册面（`ctx.promptMiddleware` 的硬 import 形态；imperative `registerPromptMiddlewareProvider` + 声明式 `registerRelatesProvider` 双入口） | 其他插件（结构类型软依赖亦可） | ✓ |
| `markdown/gate-check` | 配置面（`gates.yml` `module:` 回退） | 单仓项目配置 | ✓（niche，文档在 [modules/markdown](../modules/markdown/README.md)） |
| `gates` / `markdown` / `prompt` / `routes` | 组合行 loader 入口（行名 specifier） | cordis.patch.yml | ✓ |

非 exports 的对外协作形态（无需接线）：`ctx.gates` / `ctx.promptMiddleware`
service key 软依赖（`ctx.inject` 结构类型，零 import）。
