---
description: dsh 工作区质量门禁插件（agent 会话的 local CI）：ctx.gates 注册表 + gates_run 工具 + /gates 命令 + turn-stopping 阻塞驱动；仓库级 gates.yml 声明与插件级代码注册两种形态
---

# gates（`@catheadowl/dsh-extras`）

dsh 的工作区质量门禁插件（agent 会话的 local CI）：`ctx.gates` 注册表 +
`gates_run` 工具、`/gates` 命令与轮末 turn-stopping 驱动三个调用入口。一个 gate
是**自描述的工作单元**——check（纯读检测）+ rationale（设计说明，失败时才注入）
+ remedy（修复指引）。gate 有两种声明形态：仓库级（项目根 `gates.yml`）与插件级
（代码注册），刻意不对称，见下文架构节。设计纪要参见 local-ci-gates 设计记录
（外部开发笔记；讨论期暂名 `local-ci`，实现时定为 `gates`）。

## 安装与验证

```powershell
dsh plugin add @catheadowl/dsh-extras   # gates 是 extras 包的一行
```

装入 profile 后的行为验收（三步）：

1. 制造一个坏 Markdown 内链 → 轮末被 `doc-link` gate 拦截并续步修复；
2. `/gates` 聚合可见全部 gate（含 `coggit-misplaced` 等插件级注册项）；
3. 卸载本包（或换未装 profile）→ 曾注册过 gate 的插件照常工作（软降级）。

## 架构：两种 gate 注册形态

gate 是插件继 tool / skill 之后的**第三个显式承载点**：tool = 模型的手，
skill = 模型的知识，gate = 对模型产出的制度检查（策略驱动，模型无需知晓）。
注册形态有两种，刻意不对称：

| 形态 | 定义处 | 适用 | 类比 |
|---|---|---|---|
| 仓库级 | 项目根 `gates.yml`（每次执行按会话工作区根发现，module/command 两形态） | 仓库自带的检查（如 `doc-sync`），rationale 写在配置里 | ≈ 手写 hook 配置：不写代码，声明即生效；文件归项目、插件只是执行载体 |
| 插件级 | 代码注册（`ctx.inject(['gates'], ...)` 条件注入，先例：`@catheadowl/dsh-coggit` 的 `coggit-misplaced`） | 插件自带的检查，随插件安装/卸载自动生效/回滚 | ≈ 普通插件间软依赖协作，形成 native-like gate |

插件级注册要点：注册方用结构类型、不编译依赖本插件；未装 gates 时注册方照常工作；
inject 回调必须返回 `register` 的 disposer（纯 Map 注册表的唯一回滚通道）。
**rationale 各归其主**：仓库检查的"为什么存在"写在仓库配置里，插件检查的写在插件代码里。

**与 hooks 子系统的边界**：dsh 自带 hooks（`dsh-hooks-claude-code` 等）是配置文件方言的兼容桥（子进程 + 退出码反馈），面向既有 CC/Codex hook 资产；gates 是正常 out-of-tree 插件实现的 native-like 类型化路径（插件注册 + `GateResult` + 自描述单元），不要求宿主内置 gate 包。两者共享同一拦截点与时机词汇表，互不冲突。

触发档位、阻断预算、增量短路等执行模型的完整说明见
[docs/execution-model.md](docs/execution-model.md)；
决策推演与证据链的 SSOT 参见 local-ci-gates 设计记录（外部开发笔记）。
详细使用说明见 [docs/](docs/README.md)：执行模型 + register face + 两个"添加 gate"配方（仓库级 / 插件级）+ 维护指南。

## 提供面

| 面 | 说明 |
|---|---|
| `ctx.gates` 服务 | `register(def)` / `list()` / `definitions(root)` / `run(root, {trigger?, gate?, signal?})` / `repair(root, failures, {agent, signal?})` / `runAndRepair(root, {trigger?, gate?, signal?, agent})` |
| `gates_run` 工具 | 模型主动跑全部或单个 gate（手动维：默认只跑手动开关开着的 gate），返回聚合结果，并转发工具执行 `signal` |
| `/gates` 命令 | 人类直调，不经模型轮次 |
| `gates` 用户开关 | 浏览器 localStorage（key `dsh.gates.disabled`，JSON 双列表 `{stop, manual}`）持久化；host 侧只有内存镜像（页面加载与每次拨开关时由 UI 推给 host），按 gate 声明的 `on` 分维生效——关掉轮末维则该 gate 不进轮末、关掉手动维则不进 run-all 且显式单跑 fail loud。全局偏好（按 gate id × trigger 生效，不按工作区分）；不开 GUI 的 headless 运行没有开关状态、全部 gate 照常跑；多标签页同时打开时后写者胜（无跨标签页实时同步） |
| Settings → Plugins → Gates（Web） | 扁平 gate 列表 + 每 gate 双开关（轮末/手动，按 `on` 声明显示；Typert remote `gates/list` / `gates/setDisabled`）；经 extras 的嵌套 client 锚点包装载（见 `modules/client/README.md`），修改后需重建（`pnpm run build:client`）并重启 host |
| `gates-config-guide` skill | 人类 `/gates-config-guide` 手势注入配置指南（创建/理解/编写 `gates.yml`）；**仅用户显式调用**（`userInvocable`），模型目录与 `skill` 工具不暴露 |
| `agent/turn-stopping` 驱动 | `on:'stop'` 的 blocking gate 失败即 `steer` 续步；连续阻断上限（默认 3）耗尽后降级放行 |

插件级注册用**条件注入**（软依赖）：`ctx.inject(['gates'], c =>
c.gates.register({...}))`——未装本插件时注册方照常工作。先例：
`@catheadowl/dsh-coggit` 的 `coggit-misplaced` gate。

## gate 契约

完整的 `GateDefinition` / `GateChangeSet` / `GateViolation` 契约与公共 API
reference 见 [docs/register.md](docs/register.md)（register-docs-fresh gate
的 SSOT，随源码自动生成同步）。要点：`id` kebab-case 重名 fail loud；`rationale`
仅失败时注入；`level` 分 `blocking` / `advisory` / `defer`；stop 档的 `check`
收到会话变更集（`GateChangeSet`）用于增量短路。

仓库级 gate 在项目根 `gates.yml` 声明（按会话工作区根发现）：`module`（in-process
import，通用 `check(root, changes?)`）或 `command`（shell，非零退出即失败）；
详见 [docs/adding-a-repo-gate.md](docs/adding-a-repo-gate.md)。

## 首发 gate

- `doc-link`（**插件级**，同包 markdown 模块注册）：Markdown 链接完整性，
  数据面复用 markdown 模块内 links 事务库（`checkRepository`），git 扫描真实仓库全扫 < 1s；
  通用检查（任何有 Markdown 的仓库都成立）——装一次 extras，profile 下所有工作区自动
  获得轮末 + 手动门禁，无需每项目 shim / `gates.yml` 条目。`doc-style` 已随全自由（free-relative）废弃。
- `coggit-misplaced`（`@catheadowl/dsh-coggit` 注册）：镜像对齐检查，数据面
  `listMisplacedCognition()`（列出前自动 reconcile）；手挪文件即修复。
- `md-metadata`（**插件级**，同 markdown 模块注册，`level: defer` 旁路档）：本轮被写
  md 必须带非空 frontmatter `description`；数据面在 markdown 模块
  `src/metadata-check.ts`，消费变更集输入。

## 已知限制 / 后续

- 调度为串行；`needs`/`after` 图与并发是演进项（抄宿主
  `run-gates.ts` 形状）。
- 增量短路已落地：上次干净通过后，无脏变更的轮末整体跳过扫描；
  轮级/gate 级运行行为见 [docs/execution-model.md](docs/execution-model.md)。
  已知边界：事件流看不见编辑器/外部进程改动，由首轮全扫 + 手动全扫兜底；
  短路复用结果携带上次真跑的 `durationMs`（纯展示）；手动入口通过不回写
  轮末状态（偏保守，下个轮末不会因此短路）。
- 降级放行目前只打 `console.warn`，未进持久事件。
- defer 旁路执行（`fixer`）有两变体：`subagent`（依赖 `ctx.subagents`，默认 `fork`
  provider）与 `command`（同步跑脚本）。`subagent` 变体在 profile 未装 subagent/fork 时
  静默降级为只留脏状态（下轮重扫兜底）；fixer 子修失败时父下轮重派一个子（每轮一次、有界），
  暂无多次失败降级/冷却。`command` 变体非零退出保持脏窗口、不清脏状态。语义与递归护栏
  （`maxDepth:1`）见 [docs/execution-model.md](docs/execution-model.md)。
- module gate 的动态 `import()` 受 Node 模块缓存约束：会话期间修改
  仓库 gate 模块不会生效，需重启进程。
- 轮末驱动已接 `signal`（取消时未跑 gate 记 `skipped`）与 gate 级超时（防挂死命令卡住轮次关闭）；进程内 module 检查本身无法抢占中断，靠超时收敛。
- `yaml` 是本插件自有的 registry 依赖（`^2.9.0`）；不要为它恢复指向宿主 `.pnpm` 内部路径的 `link:` 声明（发布场景不可解析，包级 `scripts/verify-publish-readiness.mjs` 会拦截）。
- `gates-config` 是解析失败/配置冲突专用 gate 的保留 id：插件注册或项目声明同名 gate 会 fail loud；插件 gate 与项目 gate 撞名会以 `gates-config` blocking gate 暴露。
- W8 时代的裸 id 数组（全关语义）在读取用户开关时自动迁移为两维全关。

## 开发

本机构建、测试、宿主 junction 接线与组合测试的前置见
[docs/development.md](docs/development.md)。
