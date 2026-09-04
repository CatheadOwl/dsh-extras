---
description: gates 的 agent-eval 行为 case——behavior mock 层用单 agent 等价形断言 doc-link 归责过滤的驱动级 steer（只 steer 自己文件、不含他人文件）
---

# gates · eval

gates 只有一个 behavior mock case：把归责过滤的「driver 级 steer」断言下沉到 eval behavior 层。host 级并行隔离测试仍在 [`test/composition.test.mjs`](../test/composition.test.mjs)；本 case 用**单 agent 等价形** 在 headless CLI 里复现同一核心性质。

## case

| case | 断言对象 | 断言 |
|---|---|---|
| `gates-mock-attribution-filter-isolation`（[`behavior/mock/attribution-filter.eval.mjs`](behavior/mock/attribution-filter.eval.mjs)） | `trace.userMessages`（`source.plugin === 'gates'` 的 steer） | 含 `task-a.md`、不含 `task-b.md` |

预置两处断链（`task-a.md` / `task-b.md`，全扫都能看到），脚本化模型只 `write` `task-a.md`（写回同样断链，不修），轮末被 steer 的文本只提自己那处断链——隔离来自会话变更集 + 归责过滤，而非可见性。

## 三个集成点（跑前必须成立）

1. **extras markdown 模块已构建**（唯一构建依赖）：case 的 `gates.yml` `module:` 指向 `modules/markdown/lib/gate-check.js`（`./markdown/gate-check` 子路径导出的通用 `check`，与插件 `registerGate` 同源；`lib/` 是构建产物且 gitignored）。跑前先 build 该插件。
2. **profile 挂了 `tool-fs`（`write`）**：变更集采集只认 `PRECISE_WRITE_TOOLS = ['write','edit']`（`src/dirty.ts`），读 `arguments.file_path`。其它工具名归为 `opaque → true` 全算，两处断链都被 steer，隔离断言直接失败。
3. **预算 × 脚本步数对齐**：默认 `maxConsecutiveBlocks: 3` ⇒ 5 次模型调用 ⇒ 5 步脚本（`write` → "a done" → steer×3）。省步需 `maxConsecutiveBlocks: 1` 的 profile，属框架追加，不在本 case 范围。

另：`gates.yml` 的 `module` 是**绝对路径**（`moduleGate` 走 `resolve(root, moduleSpec)`，`root` = 会话 cwd = 临时 workspace），由 case 的 `prepare` 用 `fileURLToPath(import.meta.url)` 往上数 `..` 拼出。

## 运行

```powershell
# 从 extras 包根
pnpm run eval:gates
```

## 依赖关系（隔离形态）

- 框架 `@catheadowl/dsh-eval` 是 extras 的 **devDependency**（`dsh-eval` bin 消费），仅开发态——不进运行时，也不随包发布（`eval/` 不在 `files` 清单）；
- `--repo` 指向一份**已构建的 dsh 检出**（`apps/cli/lib/bin.js`）——开发期宿主借用，scripts 默认 `../../deepseek-harness`，按本机布局调整；
- 框架规则与 matcher 以 `@catheadowl/dsh-eval` 包内 README 为准。

`headless` profile 已装 gates（依赖清单见其 `package.json`）；case 是 profile 无关的，任何装了 gates + `tool-fs` 的 profile 都行。

## 覆盖边界

单 agent 等价形覆盖 spec 测试基准第 7 条（开发仓库 gate-attribution-filter spec，名称引用）的核心性质（`source ∈ W` + 隔离）。归责过滤其余子句各有 `composition.test.mjs` 的 driver 级兜底：

- **真并发**（两 agent 同写一个工作树）——`composition.test.mjs` 已覆盖；归责过滤是 `(工作树, 变更集) → steer 集` 纯函数，并发不是机制。
- **`opaque → true` 子句**——`composition.test.mjs` 有「不透明工具全 steer」driver 测。
- **`target ∈ W` 子句**——`composition.test.mjs` 有「写目标改锚点 → steer 指向源文件」driver 测。
