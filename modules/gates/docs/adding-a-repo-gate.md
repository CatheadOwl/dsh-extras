---
description: 配方：在项目根 gates.yml 添加仓库级 gate（module/command 两形态、字段速查、验证与坑）
---

# 配方：添加仓库级 gate（项目 `gates.yml` 声明）

> 适用：检查逻辑属于**仓库**（不随某个插件安装与否而存亡），如文档链接完整性、命名纪律。类比"手写 hook 配置"——不写插件代码，声明即生效。插件自带检查看 [adding-a-plugin-gate](adding-a-plugin-gate.md)。
>
> **所有权模型**：`gates.yml` 归**项目**，gates 插件只是执行载体（与 hooks.json 归项目同构）。每次执行时从会话工作区根发现；没有该文件的工作区什么检查都不跑——检查永不跨工作区泄漏。方言为 gates 插件暂行定义（宿主无内置 gate 配置方言；上游跟进方向见 gates-followup 外部开发笔记）。

## 前提

- profile 已装 gates 插件（`dsh plugin add <gates 路径>`）——它提供执行载体；
- 检查本体已存在：一个纯函数模块或一条可退出码判定的命令。

## 两种形态

在项目根建 `gates.yml`：

### 1. module（in-process，首选）

```yaml
# <项目根>/gates.yml
gates:
  - id: md-metadata              # kebab-case，全局唯一，重名注册即报错
    module: scripts/md-metadata-lib.mjs   # 相对会话工作区根解析
    description: 一句话，进列表与失败反馈标题
    rationale: >-
      为什么存在这个检查 + 为什么手改是安全的。
      只在失败时注入模型，平时零成本——写清动机，别怕长。
```

模块需导出**通用表面**：

- **通用形状**：`check(root, changes?, options?): GateViolation[]`（或返回 Promise）；`changes` 为可选会话变更集 `{paths, opaque}`，仅 stop 档提供（manual 入口为 undefined）；`options` 为条目声明的 `options` 覆写（未声明即 undefined）。

路径注意：`module` 在**会话工作区根**（运行时事实）解析；找不到模块会报 "gate module not found" 违规。`gates.yml` 按 mtime 缓存，改了下一轮即生效。

### 2. command（shell，兜底）

```yaml
  - id: my-lint
    command: node scripts/lint.mjs
    level: advisory        # 可选，默认 blocking
    timeoutMs: 60000       # 可选，默认 120000
```

退出码 0 = 通过；非零 = 失败，stdout+stderr（截断 4000 字符）作为违规原因进入反馈。挂死会被超时 `kill` 并按失败收敛，不会卡住轮次。

命令可经环境变量 `GATE_CHANGES` 读取会话变更集（JSON，`{"paths":[...],"opaque":bool}`）；manual 入口不注入该变量。需要时在命令里自行解析过滤。

## 字段速查

### options 覆写（给插件级 gate 传仓库策略）

`options`（mapping）是仓库策略通道：module gate 作为 `check` 第三参数收到、command gate 经 `GATE_OPTIONS`（JSON）env 收到。**纯 `id` + `options` 条目**（不声明 `module`/`command`）按 id 覆写**插件注册**的 gate——不重复执行体，只覆盖策略；覆写未知 id 或项目自声明 gate 会 fail loud（`gates-config`）：

```yaml
gates:
  - id: doc-link            # 插件注册的 gate：纯 options 覆写
    options:
      frozen-dirs: [archived]
```

**每个 gate 认识哪些键由该 gate 自己的文档定义**（gates 插件不解释任何键）。随包 `@catheadowl/dsh-extras`：doc-link 的 `frozen-dirs`（冻结目录豁免：gate 不查其出链、`md_rename` 视其只读）见 markdown 模块 [doc-link-gate](../../markdown/docs/doc-link-gate.md)。

### 全字段

| 字段 | 必需 | 说明 |
|------|------|------|
| `id` | ✓ | kebab-case；全局唯一；重名、非法或使用保留 id 即报错 |
| `module` / `command` | 二选一 ✓ | 都没有 → 物化时 fail loud（唯一例外：纯 `options` 覆写条目，见下） |
| `description` | 建议 | 列表/反馈标题 |
| `rationale` | 建议 | 失败时注入的设计说明 |
| `level` | 可选 | `blocking`（默认）/ `advisory` / `defer` |
| `timeoutMs` | 可选 | 默认 120000 |
| `relevant` | 可选 | 增量短路相关性模式（如 `['*.md']`）；仅精确脏轮里与脏路径无关时复用上轮通过结果 |
| `fixer` | 可选 | 仅 `defer` 档合法；两变体：`{ kind: 'subagent', prompt, request? }` 派继承上下文的子 agent 离线修（`prompt` 静态指令、派发时自动追加失败文件清单，`request` 透传 `provider`/`persona`/`toolFilter`/`agentOptions`）；`{ kind: 'command', command }` 同步跑脚本（cwd=工作区根、带超时），非零退出保持脏窗口（下轮重扫） |
| `options` | 可选 | 仓库策略覆写（mapping）：module gate 作为 `check` 的第三个参数收到；command gate 经 `GATE_OPTIONS`（JSON）环境变量收到。键语义由各 gate 自定义（如 markdown 模块 doc-link 的 `frozen-dirs`），gates 插件不解释任何键 |

`level` 三档去向：`blocking`（默认，失败 `steer` 续步）/ `advisory`（只报告，永不 steer）/ `defer`（失败不打断 turn、派 `fixer` 离线修或无 fixer 仅留进程内无状态脏标记，脏窗口保持 dirty 直到下轮重扫转绿——适合「必须补、但不必现在打断」的检查，典型如 `md-metadata`）。`fixer` 是 defer 的「旁路执行」半程：不声明则 defer 只留脏状态（无状态，下轮重扫仍红，等人/下一轮消费面修）；声明 `subagent` 则派一个继承会话上下文的子 agent 直接修，声明 `command` 则同步跑修复脚本（非零退出 = 修复失败，下轮重扫照常重扫）。机制与边界详见 [execution-model.md](execution-model.md)。注意 `level` 词汇表在插件加载时定死：新增 `defer` 档需重启 host（`gates.yml` 本身按 mtime 热读不受此限）。

`fixer` 声明示例（`md-metadata` 的语义修复——description 不能机械提取，只能由带上下文的 LLM 写）：

```yaml
  - id: md-metadata
    module: scripts/md-metadata-lib.mjs
    level: defer
    fixer:
      kind: subagent
      prompt: >-
        You are repairing a workspace quality-gate failure. Each file listed
        below must declare a non-empty `description` in its YAML frontmatter.
        For each file: read it, then add (or fill) a `description` field.
```

机械修复（规范化/生成脚本）用 `command` 变体，同步执行、非零退出保持脏窗口（下轮重扫）：

```yaml
  - id: format-lock
    command: node scripts/check-format.mjs
    level: defer
    fixer:
      kind: command
      command: node scripts/format.mjs
```

## 实例与教学示例

`doc-link` 与 `md-metadata` 均已作为 `@catheadowl/dsh-extras` markdown 模块的插件级 gate 提供（见 [adding-a-plugin-gate](adding-a-plugin-gate.md)）——项目级**声明执行体**会与插件 gate 撞名（重名注册即报错）；但项目可以用**纯 `options` 条目**（字段速查 §options 覆写）给插件 gate 覆写仓库策略：条目不声明 `module`/`command`、只携带有效的 `id` + `options`（其余字段不参与判定、写了无效），如 `doc-link` 的 `frozen-dirs: [archived]`。覆写条目的 id 必须命中某个插件注册的 gate；指向项目自声明 gate 或未知 id 都会 fail loud（`gates-config` 报错）。同一策略面（如 frozen-dirs）的其他承载（`md_rename` 工具）也读同一份声明——单一策略源，不改执行体。

module 形态的教学示例仍以 `md-metadata` 为标本：上文的声明片段与 fixer 示例就是仓库级声明原样（`check(root, changes?, options?)` 的导出形状、defer + subagent fixer 的声明语法），**完整可跑的参考实现**在同包 [`examples/md-metadata/module-form.mjs`](../examples/md-metadata/module-form.mjs)（冻结标本：仓库级数据面原样迁入，不随活代码演进；活的数据面在 markdown 模块 `src/metadata-check.ts`，插件级注册见其 `src/index.ts`）。要为自己的仓库声明等价检查时，把标本拷进仓库、`module:` 指过去，并换一个不撞名的 `id`。

`gates.yml` 解析失败时不会静默：会以一个专用 `gates-config` blocking gate 报错，驱动修复配置文件本身。

`gates-config` 是内部保留 id；项目级 gate 不能声明该 id。

## 验证

1. `gates.yml` 落盘后（无需重启）：`/gates` 或让模型调 `gates_run` 看聚合输出；
2. 故意制造一条违规 → 轮末应被拦截并收到定位 + rationale + fix 指引；
3. 修复后再次收尾应静默通过。

## 坑

- **module 受 Node import 缓存**：会话期间改 gate 模块不生效，需重启（`gates.yml` 本身不受此限，按 mtime 重载）。
- 慢检查优先优化自身或声明 `relevant`（精确脏轮可跳过无关检查，无脏轮整体短路）；仍慢则调 `level: advisory`。
  增量短路已实现，见 [execution-model.md](execution-model.md)。
