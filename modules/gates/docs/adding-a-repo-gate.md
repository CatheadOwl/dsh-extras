---
description: 配方：在项目根 gates.yml 添加仓库级 gate（module/command 两形态、字段速查、验证与坑）
---

# 配方：添加仓库级 gate（项目 `gates.yml` 声明）

> 适用：检查逻辑属于**仓库**（不随某个插件安装与否而存亡），如文档
> 链接完整性、命名纪律。类比"手写 hook 配置"——不写插件代码，声明即生效。
> 插件自带检查看 [adding-a-plugin-gate](adding-a-plugin-gate.md)。
>
> **所有权模型**：`gates.yml` 归**项目**，gates 插件只是执行载体（与
> hooks.json 归项目同构）。每次执行时从会话工作区根发现；没有该文件的
> 工作区什么检查都不跑——检查永不跨工作区泄漏。方言为 gates 插件暂行定义
> （宿主无内置 gate 配置方言，见 `explorer/hook-points/gates-followup.md`）。

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

- **通用形状**：`check(root, changes?): GateViolation[]`（或返回 Promise）；
  `changes` 为可选会话变更集 `{paths, opaque}`，仅 stop 档提供（manual 入口为 undefined）。

路径注意：`module` 在**会话工作区根**（运行时事实）解析；找不到模块会报
"gate module not found" 违规。`gates.yml` 按 mtime 缓存，改了下一轮即生效。

### 2. command（shell，兜底）

```yaml
  - id: my-lint
    command: node scripts/lint.mjs
    level: advisory        # 可选，默认 blocking
    timeoutMs: 60000       # 可选，默认 120000
```

退出码 0 = 通过；非零 = 失败，stdout+stderr（截断 4000 字符）作为
违规原因进入反馈。挂死会被超时 `kill` 并按失败收敛，不会卡住轮次。

命令可经环境变量 `GATE_CHANGES` 读取会话变更集（JSON，
`{"paths":[...],"opaque":bool}`）；manual 入口不注入该变量。需要时在命令里自行解析过滤。

## 字段速查

| 字段 | 必需 | 说明 |
|------|------|------|
| `id` | ✓ | kebab-case；全局唯一；重名、非法或使用保留 id 即报错 |
| `module` / `command` | 二选一 ✓ | 都没有 → 物化时 fail loud |
| `description` | 建议 | 列表/反馈标题 |
| `rationale` | 建议 | 失败时注入的设计说明 |
| `level` | 可选 | `blocking`（默认）/ `advisory` / `defer` |
| `timeoutMs` | 可选 | 默认 120000 |
| `relevant` | 可选 | 增量短路相关性模式（如 `['*.md']`）；仅精确脏轮里与脏路径无关时复用上轮通过结果 |
| `fixer` | 可选 | 仅 `defer` 档合法；两变体：`{ kind: 'subagent', prompt, request? }` 派继承上下文的子 agent 离线修（`prompt` 静态指令、派发时自动追加失败文件清单，`request` 透传 `provider`/`persona`/`toolFilter`/`agentOptions`）；`{ kind: 'command', command }` 同步跑脚本（cwd=工作区根、带超时），非零退出保持脏窗口（下轮重扫） |

`level` 三档去向：`blocking`（默认，失败 `steer` 续步）/ `advisory`（只报告，永不
steer）/ `defer`（失败不打断 turn、派 `fixer` 离线修或无 fixer 仅留进程内无状态脏标记，
脏窗口保持 dirty 直到下轮重扫转绿——适合「必须补、但不必现在打断」的检查，典型如
`md-metadata`）。`fixer` 是 defer 的「旁路执行」半程：不声明则 defer 只留脏状态（无状态，下轮重扫仍红，
等人/下一轮消费面修）；声明 `subagent` 则派一个继承会话上下文的子 agent 直接修，声明 `command` 则同步
跑修复脚本（非零退出 = 修复失败，下轮重扫照常重扫）。机制与边界详见
[execution-model.md](execution-model.md)。注意 `level` 词汇表在插件加载时定死：新增
`defer` 档需重启 host（`gates.yml` 本身按 mtime 热读不受此限）。

`fixer` 声明示例（`md-metadata` 的语义修复——description 不能机械提取，只能由带上下文的
LLM 写）：

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

## 本仓库实例

dsh 仓库根的 `gates.yml` 的 `md-metadata` 条目就是 module 形态的完整实例（rationale
含检查范围与旁路修复策略）。`doc-link` 曾是 module 形态的另一实例，2026-08-30 已
升华为插件级 gate（`dsh-plugin-dev/extras/modules/md/` 注册，见
[adding-a-plugin-gate](adding-a-plugin-gate.md)）——项目级声明会与插件 gate 撞名，
不再适合当仓库级示例。`gates.yml` 解析失败时不会静默：会以一个专用 `gates-config`
blocking gate 报错，驱动修复配置文件本身。

`gates-config` 是内部保留 id；项目级 gate 不能声明该 id。

## 验证

1. `gates.yml` 落盘后（无需重启）：`/gates` 或让模型调 `gates_run` 看聚合输出；
2. 故意制造一条违规 → 轮末应被拦截并收到定位 + rationale + fix 指引；
3. 修复后再次收尾应静默通过。

## 坑

- **module 受 Node import 缓存**：会话期间改 gate 模块不生效，需重启
  （`gates.yml` 本身不受此限，按 mtime 重载）。
- 慢检查优先优化自身或声明 `relevant`（精确脏轮可跳过无关检查，无脏轮整体短路）；仍慢则调 `level: advisory`。
  增量短路已落地（W2），见 [execution-model.md](execution-model.md)。
