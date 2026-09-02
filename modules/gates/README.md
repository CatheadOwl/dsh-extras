---
description: dsh 工作区质量门禁插件（agent 会话的 local CI）：ctx.gates 注册表 + gates_run 工具 + /gates 命令 + turn-stopping 阻塞驱动；仓库级 gates.yml 声明与插件级代码注册两种形态
---

# gates（`@catheadowl/dsh-extras`）

dsh 的工作区质量门禁插件（agent 会话的 local CI）：`ctx.gates` 注册表 +
三个调用入口。一个 gate 是**自描述的工作单元**——check（纯读检测）+
rationale（设计说明，失败时才注入）+ remedy（修复指引）。命名沿革：
讨论期暂名 `local-ci`，实现时定为 `gates`（与接缝 `ctx.gates` 一致；
"local CI" 非业界术语，仅作解释性文案）。设计纪要见
`docs/meeting-room/20260822-1436-local-ci-gates/`。

项目价值、PRD、ADR、spec、roadmap 和 TODO 路由放在开发仓库的
`workunits/gates/README.md`（外层仓库层，不随包发布）。本文件只保留
插件本体叙事、契约和使用说明。

## 定位：gate 能力承载面

纯全量扫描的 gate 只是把宿主 `run-gates.ts` 横向搬进会话（同质功能换地方）；
gates 的差异化价值 = 把插件可以直接消费的**运行时事实**整理成 gate 抽象：
会话 cwd（已用，多工作区天然正确）、轮次预算与 signal（已用，宿主自己都没做的续步守卫）、
会话变更集（已用，W2 增量短路的脏分类数据源；事实 SSOT 见开发仓库
`explorer/session-change-set/`，gates 消费契约见
`workunits/gates/spec/gate-change-set-consumption.md`）、
工具事件流（未用，按类型路由）。
真正要验证的是：插件开发者是否需要一个继 tool / skill 之后的 gate 承载空间，
而不是每个插件各自监听 `agent/turn-stopping`、自建预算和反馈协议。演进主轴按「下一批
要消费并框架化的运行时事实」组织，线头清单见开发仓库认知层
`dsh-plugin-dev_cognition/gates/open-threads.md`
（计划文件不进可发布的插件目录，故落认知层）。

## 架构：两种 gate 注册形态

gate 是插件继 tool / skill 之后的**第三个显式承载点**：tool = 模型的手，
skill = 模型的知识，gate = 对模型产出的制度检查（策略驱动，模型无需知晓）。
注册形态有两种，刻意不对称：

| 形态 | 定义处 | 适用 | 类比 |
|---|---|---|---|
| 仓库级 | 项目根 `gates.yml`（每次执行按会话工作区根发现，module/command 两形态） | 仓库自带的检查（如 `doc-sync`），rationale 写在配置里 | ≈ 手写 hook 配置：不写代码，声明即生效；文件归项目、插件只是执行载体 |
| 插件级 | 代码注册（`ctx.inject(['gates'], ...)` 条件注入，先例：coggit 的 `coggit-misplaced`） | 插件自带的检查，随插件安装/卸载自动生效/回滚 | ≈ 普通插件间软依赖协作，形成 native-like gate |

插件级注册要点：注册方用结构类型、不编译依赖本插件；未装 gates 时注册方照常工作；
inject 回调必须返回 `register` 的 disposer（纯 Map 注册表的唯一回滚通道）。
**rationale 各归其主**：仓库检查的"为什么存在"写在仓库配置里，插件检查的写在插件代码里。

触发/执行模型：`stop` 档在每个轮末（`agent/turn-stopping` 检查点）执行，通过时静默、
失败才阻断（注入 rationale + 定位列表续步），连续阻断预算默认 3 耗尽降级放行；
`defer` 档失败不阻断主会话（旁路，无状态：失败留进程内脏状态、按 `fixer` 离线修、下轮重扫自愈）；`manual` 档仅显式
调用时跑。用户在 Web 配置页（Settings → Plugins → Gates）对每个 gate 有两个独立开关——**轮末**
（固定、强制）与**手动**（agent 自行选择）——按 gate 声明的 `on` 显示；被关掉的那一维不再进入
对应执行路径（关轮末 → 不进轮末扫描；关手动 → 不进 run-all、显式单跑 fail loud 报"已在设置中禁用手动运行"）。
开关双列表持久化在浏览器 localStorage，host 侧只有内存镜像（页面加载时由 UI 重推）。

**与 hooks 子系统的边界**：dsh 自带 hooks（`dsh-hooks-claude-code` 等）是配置文件方言的兼容桥（子进程 + 退出码反馈），面向既有 CC/Codex hook 资产；gates 是正常 out-of-tree 插件实现的 native-like 类型化路径（插件注册 + `GateResult` + 自描述单元），不要求宿主内置 gate 包。两者共享同一拦截点与时机词汇表，互不冲突。宿主已声明但未实现的方向（按会话项目级配置发现 `TODO(per-session-hook-config)`、Stop 阻断上限 `TODO(stop-loop-guard)`）与树外先行实现的对应关系、跟进清单见开发仓库 `explorer/hook-points/gates-followup.md`。

决策推演与证据链的 SSOT：`docs/meeting-room/20260822-1436-local-ci-gates/`（plan-1 为决策记录）。
详细使用说明见 [docs/](docs/README.md)：执行模型 + register face + 两个"添加 gate"配方（仓库级 / 插件级）+ 维护指南。

## 提供面

| 面 | 说明 |
|---|---|
| `ctx.gates` 服务 | `register(def)` / `list()` / `definitions(root)` / `run(root, {trigger?, gate?, signal?})` / `repair(root, failures, {agent, signal?})` / `runAndRepair(root, {trigger?, gate?, signal?, agent})` |
| `gates_run` 工具 | 模型主动跑全部或单个 gate（手动维：默认只跑手动开关开着的 gate），返回聚合结果，并转发工具执行 `signal` |
| `/gates` 命令 | 人类直调，不经模型轮次 |
| `gates` 用户开关 | 浏览器 localStorage（key `dsh.gates.disabled`，JSON 双列表 `{stop, manual}`）持久化；host 侧只有内存镜像（页面加载与每次拨开关时由 UI 推给 host），按 gate 声明的 `on` 分维生效——关掉轮末维则该 gate 不进轮末、关掉手动维则不进 run-all 且显式单跑 fail loud |
| Settings → Plugins → Gates（Web） | 扁平 gate 列表 + 每 gate 双开关（轮末/手动，按 `on` 声明显示；Typert remote `gates/list` / `gates/setDisabled`） |
| `gates-config-guide` skill | 人类 `/gates-config-guide` 手势注入配置指南（创建/理解/编写 `gates.yml`）；**仅用户显式调用**（`userInvocable`），模型目录与 `skill` 工具不暴露 |
| `agent/turn-stopping` 驱动 | `on:'stop'` 的 blocking gate 失败即 `steer` 续步；连续阻断上限（默认 3）耗尽后降级放行 |

插件级注册用**条件注入**（软依赖）：`ctx.inject(['gates'], c =>
c.gates.register({...}))`——未装本插件时注册方照常工作。先例：
`dsh-plugin-dev/coggit` 的 `coggit-misplaced` gate。
## gate 契约（要点）

```ts
interface GateDefinition {
  id: string            // kebab-case，重名注册 fail loud；on/level 取值也边界校验
  description: string
  rationale: string     // 为什么存在、为什么手改安全；仅失败时注入
  on: ('stop' | 'manual')[]
  level: 'blocking' | 'advisory' | 'defer'   # defer: 失败不 steer,按 fixer 离线修(无状态,下轮重扫自愈)
  timeoutMs?: number    // 单次检查硬上限；超时按 failed+error 收敛（Config gate 默认 120s）
  relevantPath?: (path: string) => boolean  // W2 增量短路：仅精确脏轮里与脏路径无关时可复用上轮通过结果（gates.yml 用 relevant 模式声明）
  check(root: string, changes?: GateChangeSet): Promise<GateViolation[]>  // 只读；root = 会话 cwd；changes = 会话变更集（stop 档提供）
}
interface GateChangeSet {
  paths: string[]  // 精确 write/edit 路径（自上次干净通过累计）
  opaque: boolean  // 出现不透明写（bash/subagent）→ paths 不全；manual 入口无 changes
}
interface GateViolation {
  file?: string; line?: number; reason: string
  remedy?: { kind: 'manual'; guidance: string }
         | { kind: 'operation'; operation: string }  // 仅 operation id
}
```

仓库级 gate 在项目根 `gates.yml` 声明（按会话工作区根发现）：`module`（in-process
import，通用 `check(root, changes?)`）或 `command`（shell，非零退出即失败）；
详见 [docs/adding-a-repo-gate.md](docs/adding-a-repo-gate.md)。

## 首发 gate

- `doc-link`（**插件级**，`dsh-plugin-dev/extras/modules/md` 注册）：Markdown 链接完整性，
  数据面复用 `@catheadowl/dsh-md-links`（`checkRepository`），git 扫描真实仓库全扫 < 1s；
  通用检查（任何有 Markdown 的仓库都成立）——装一次该插件，profile 下所有工作区自动
  获得轮末 + 手动门禁，无需每项目 shim / `gates.yml` 条目（原仓库级
  `scripts/doc-link-lib.mjs` 薄 shim 已归档）。`doc-style` 已随全自由（free-relative）废弃。
- `coggit-misplaced`（coggit 插件注册）：镜像对齐检查，数据面
  `listMisplacedCognition()`（列出前自动 reconcile）；手挪文件即修复。
- `md-metadata`（仓库级，本仓库根 `gates.yml` 声明，`level: defer` 旁路档）：本轮被写
  md 必须带非空 frontmatter `description`；数据面 `scripts/md-metadata-lib.mjs`，消费
  变更集输入（T6 首个消费者）。

## 本机命令

```powershell
Set-Location d:\Document\Projects\dsh\dsh-plugin-dev\extras\modules\gates
# 直调，不走 pnpm run（pnpm 在此目录会触发依赖状态校验）
..\..\..\..\deepseek-harness\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json
..\..\..\..\deepseek-harness\node_modules\.bin\tsc.cmd -p tsconfig.json
..\..\..\..\deepseek-harness\node_modules\.bin\tsdown.cmd   # Web 配置页 client bundle → lib/client.js
# 单测清单以 extras 包根 package.json 的 scripts.test:gates 为准（SSOT），此处不复述
node --test --test-isolation=none <package.json test 列出的文件>
# 组合测试：真实 agent-loop + mock adapter，验证 turn-stopping 驱动（defer 旁路 / blocking 续步）
# 不在 `pnpm verify` 内：依赖 host 源码 junction（见下），新克隆 / 非本机不可跑；
# 前置：先 build md 模块（W10 用例 import 其 lib/gate-check.js 构建产物）
node --test --test-isolation=none test/composition.test.mjs
```

junction 解析层：**extras 包根 `node_modules/`**（`dsh-plugin-dev/extras/node_modules`，
全模块共享一份）的 `@deepseek-ai/{cordis,schemastery,dsh-tools,
dsh-llm,dsh-agent,dsh-session,dsh-typert-protocol,dsh-invariants}` 指向
vendored 源码的 `lib/types`/包目录
（参照 07 章配方；`dsh-commands`、`dsh-skill`、`dsh-subagent` 仅类型面，走
`import type {}`，插件 lib 运行时不需要 junction）。组合测试
（`test/composition.test.mjs`）额外需要 `dsh-system-prompt`、`dsh-agent-loop`、
`dsh-subagent`、`dsh-subagent-fork-in-process` 四个 junction，同样指向 host 包目录；
`dsh-md-links` 依赖 md-links 包（尚未迁入 extras 时按其目录解析）。
Web 配置页（client half）的类型依赖走 tsconfig `paths` 指向 host 包 `lib/types`；
`react` / `@types/react` 以 junction 指向 vendored `.pnpm` 的版本化路径。
**不要在此目录跑 `pnpm install`**。

校验脚本用的 TypeScript 走同一约定：包根 `node_modules/typescript`
junction 指向宿主安装。脚本代码里**零宿主路径字面量**（包级 `scripts/lib/resolve-typescript.mjs`
只认本地可解析的 `typescript` 与 `DSH_TYPESCRIPT_PATH` 覆盖），越出包根的
import / `new URL(...)` 路径会被 `publish-readiness` gate 拦截。

## 安装与验证

```powershell
dsh plugin add d:\Document\Projects\dsh\dsh-plugin-dev\extras   # 装的是 extras 包（gates 是其中一行）
```

装入 profile 后按 `docs/meeting-room/20260822-1436-local-ci-gates/` 两个 case 文件的"预期"节做行为验收：坏链接触发轮末续步修复、`/gates` 聚合、卸载后注册方不受影响等。注意：case 文档为讨论期档案，其中名称/路径为旧称（`ci_run`/`/ci` 现为 `gates_run`/`/gates`，`local-ci` 现为 `gates`，`vscode-plugins/codebase/coggit` 现为 `dsh-plugin-dev/coggit`）。

## 已知限制 / 后续

- 调度为串行；`needs`/`after` 图与并发是演进项（抄宿主
  `run-gates.ts` 形状）。
- 增量短路已落地（W2）：上次干净通过后，无脏变更的轮末整体跳过扫描；
  脏分类来源见开发仓库 `explorer/session-change-set/`，
  gates 消费契约见 `workunits/gates/spec/gate-change-set-consumption.md`，
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
- 用户开关是**全局偏好**（按 gate id × trigger 生效，不按工作区分），持久化在**浏览器
  localStorage**（`dsh.gates.disabled`，双列表 `{stop, manual}`），host 只有内存镜像：
  host 重启后由 GUI 页面加载时重推（不开 GUI 的 headless 运行没有开关状态，全部 gate 照常跑）。
  多标签页同时打开时后写者胜（每次拨开关推整表；无跨标签页实时同步）。W8 时代的裸 id 数组
  （全关语义）在读取时自动迁移为两维全关。
- Web 配置页（Settings → Plugins → Gates）经 extras 的嵌套 client 锚点包装载（见 `modules/client/README.md`）；修改后需重建（`pnpm run build:client`）并重启 host 才会被加载。
- 触发时机语义与成本纪律的机制底账：开发仓库 `explorer/hook-points/README.md`（事件三模式 / 轮末检查点 / 成本四维度）。
