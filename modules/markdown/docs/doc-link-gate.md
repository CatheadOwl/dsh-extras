---
description: markdown 模块的 doc-link gate——Markdown 内链完整性门禁：插件级随包自动注册（首选），仓库级 gates.yml module 回退（单仓声明），数据面与 md_rename 共享模块内 links 事务库（单拷贝）
---

# doc-link gate

**价值**：装一次 `@catheadowl/dsh-extras`，该 profile 下所有工作区自动获得
Markdown 内链完整性门禁——轮末自动检查 + 手动 `/gates`、`gates_run` 可用，
断链当轮即被定位并携带修复提示，无需每项目配置任何东西。

**与宿主的关系**：dsh 会话轮末检查点上的一个插件级 gate，由 markdown 模块
（extras 的一行）经 gates 模块的消费面
`@catheadowl/dsh-extras/gates/register` 注册；gates 模块缺席（或被单关）时
markdown 模块照常加载、只是不注册本 gate。

## 两种接入形态

| 形态 | 做法 | 适用 |
|---|---|---|
| **插件级（首选）** | 安装 extras 包（markdown 行默认装载） | profile 下所有工作区自动获得，零配置 |
| **仓库级回退** | 项目根 `gates.yml` 条目 `module: '@catheadowl/dsh-extras/markdown/gate-check'` | 未装 extras（或关掉 markdown 行）但单个仓库想要链接门禁的项目 |

两种形态同一份 `check` 实现、语义互斥：插件级已注册时根 `gates.yml` 不再保留
`doc-link` 条目（撞名会以 `gates-config` 冲突 gate 暴露）。

## 模块

| 模块 | 职责 |
|---|---|
| `src/gate-check.ts` | 通用 gate 表面 `check(root, changes?)`：形状适配 + 轮末归责谓词；由 `markdown/gate-check` 子路径导出，供 `gates.yml` `module:` 回退与测试复用 |
| `src/index.ts` | 插件入口：`apply(ctx)` → `registerGate(ctx, { id: 'doc-link', … })`（硬导入消费面，软服务依赖——gates 缺席时本模块照常加载、不注册） |

> **机制归模块内 links 库，政策归本 gate 面。** 数据面（git 扫描 + mdast 解析 +
> 锚点校验）在 [links-lib](links-lib.md)（`src/links/`，与 `md_rename` 工具共享、
> 同版本演进的单拷贝）；本 gate 面只持有政策——`rationale`、`level: blocking`、
> `relevantPath`（`*.md`）、轮末归责谓词。

## 契约要点

- gate id `doc-link`；`on: ['stop','manual']`、`level: 'blocking'`
  （无确定性修复内核的语义修复，保持阻断档）。
- `relevantPath` = `*.md`（**大小写不敏感**：`README.MD` 之类大写后缀也重扫）：
  仅脏路径含 md 的轮重扫，其余复用上轮通过结果（非 Markdown 工作区零扫描即过）。
- 外部目标（`//`、`/`、scheme）与指向非 Markdown 目标的 fragment 从不标记
  （links 库语义）。
- anchor-missing 的 remedy guidance 携带**确定性修复提示**：目标文档里与失败
  fragment 最长公共前缀相同的标题（平局按文档序，≤3 条），每条带
  「标题文本 → 精确 #anchor」——agent 认领标题、抄锚点即可，无需知道 slug 规则；
  无共享前缀则退回静态指引。

## 构建与测试

```powershell
# 从 extras 包根（宿主检出路径借用与 junction 接线见包根 README 开发节）
pnpm run check-types:markdown
pnpm run build:markdown
pnpm run test:markdown    # 含 doc-link-gate 套件
```

## 验证

安装 extras 后：故意写一条断链 → 轮末被 steer 定位 + rationale + remedy；
修复后静默通过。手动面：`/gates` 聚合中出现 `doc-link`（插件注册）。
