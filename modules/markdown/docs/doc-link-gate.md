---
description: md-links-gates 插件（@catheadowl/dsh-md-links-gates）——通用 Markdown 链接完整性 gate（doc-link）的插件级注册：装一次、整个 profile 的所有工作区轮末 + 手动自动校验，零每项目 shim / gates.yml 条目
---

# md-links-gates 插件

把 `doc-link`（内部 Markdown 引用完整性检查）从「每项目一份薄 shim」升华为
**插件级 gate**：装一次，该 profile 下所有工作区自动获得轮末 + 手动的链接完整性门禁，
无需拷 shim、无需写 `gates.yml` 条目。

## 定位

> **机制归 `@catheadowl/dsh-md-links`，政策归本插件。** 数据面（git 扫描 + mdast 解析 +
> 锚点校验）在 [md-links](links-lib.md) 纯库；本插件只持有政策——
> `rationale`、`level: blocking`、W2 `relevantPath`（`*.md`）、轮末归责谓词。

接入形态：

| 形态 | 做法 | 效果 |
|---|---|---|
| **插件级（首选）** | `dsh plugin add <本目录绝对路径>`（装入 profile） | 该 profile 所有工作区自动出现 `doc-link`（`/gates`、`gates_run`、轮末全可用）；非 Markdown 工作区零扫描即过 |
| **仓库级回退** | `gates.yml` 条目 `module: <本包>/lib/index.js` | 项目自己声明，语义同旧 `scripts/doc-link-lib.mjs` 薄 shim（已归档）——同一份 `check` |

## 模块

| 模块 | 职责 |
|---|---|
| `src/gate-check.ts` | 通用 gate 表面 `check(root, changes?)`：形状适配 + W10 归责谓词（从归档的 `scripts/doc-link-lib.mjs` 迁入，语义不变）；`./markdown/gate-check` 子路径导出，供 `gates.yml` `module:` 回退与测试复用 |
| `src/index.ts` | 插件入口：`apply(ctx)` → `registerGate(ctx, { id: 'doc-link', … })`（ADR 0003 硬导入面，软服务依赖——gates 缺席时本插件照常加载、不注册） |

## 契约要点

- gate id `doc-link`（沿用已定 id，与历史一致）；`on: ['stop','manual']`、`level: 'blocking'`
  （无确定性修复内核的语义修复，保持阻断档；转 `defer` 走 gates 转 defer 落地（开发仓库 workunits/gates/README.md，纯文本引用） 的前置 probe）。
- `relevantPath` = `*.md`（**大小写不敏感**：`README.MD` 之类大写后缀也重扫——比原仓库级
  `relevant: ['*.md']` 的大小写敏感匹配更保守，且与 md-links 自身的 md 过滤一致）：仅脏路径
  含 md 的轮重扫，其余复用上轮通过结果。
- 外部目标（`//`、`/`、scheme）与指向非 Markdown 目标的 fragment 从不标记（md-links 语义）。
- anchor-missing 的 remedy guidance 携带**确定性修复提示**：目标文档里与失败 fragment 最长公共前缀
  相同的标题（平局按文档序，≤3 条），每条带「标题文本 → 精确 #anchor」——agent 认领标题、抄锚点
  即可，无需知道 slug/bump 规则；无共享前缀则退回静态指引。

## 构建 / 测试

```powershell
Set-Location d:\Document\Projects\dsh\dsh-plugin-dev\md-links-gates
pnpm install          # 物化 link: junction（离线即可，复用宿主 store）
..\..\deepseek-harness\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json  # check-types
..\..\deepseek-harness\node_modules\.bin\tsc.cmd -p tsconfig.json          # build
node --test --test-isolation=none test/doc-link-gate.test.mjs              # test
```

测试 import 已构建 `lib/`；运行时依赖经 `node_modules` junction 解析
（`@catheadowl/dsh-md-links` → 同层 md-links；`@catheadowl/dsh-extras` → 同层 gates 的
`./gates/register` 面）。**不要在此目录跑 `pnpm install` 之外的东西**——junction 指向宿主检出，
宿主升级依赖版本时需同步重建（同树外脆弱性范畴）。

## 装入

```powershell
dsh plugin add d:\Document\Projects\dsh\dsh-plugin-dev\md-links-gates
```

装入后 `/gates` 聚合出现 `doc-link`（插件注册），与仓库级声明互斥：根 `gates.yml`
不再保留 `doc-link` 条目（撞名会以 `gates-config` 冲突 gate 暴露）。验证：故意写一条断链
→ 轮末被 steer 定位 + rationale + remedy；修复后静默通过。
