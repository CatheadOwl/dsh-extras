---
description: extras 的 markdown 模块——同一 fiber 的三个模型面：`md_rename` 写工具（移动/改名 + 全仓双向引用重定位，确定性 + 冲突交 agent）、`doc-link` 完整性 gate 与 `md-metadata` 元数据 gate（defer + subagent fixer）；数据面事务内核在模块内 src/links（原 md-links 纯库）
---

# markdown 模块（`@catheadowl/dsh-extras` 一行）

一个 fiber、三个模型面：`md_rename` agent tool（移动文件/目录并同步重定位本仓库内全部 Markdown 引用——入链改写 + 出链 rebase，确定性、冲突交 agent）、`doc-link` gate（Markdown 链接完整性，stop/manual，blocking）与 `md-metadata` gate（会话被写 md 必须带非空 frontmatter `description`，defer + subagent fixer 离线补写）。行级 `disabled` 同时关掉三者。

## 定位

> **rename 工具保证「移动/改名后所有内部链接仍可解析」；doc-link gate 保证「轮末所有内部链接仍可解析」；不引入 runtime，git 工作树即状态。**

数据面与事务内核在模块内 [`src/links/`](docs/links-lib.md)；`md_rename` 是其上的薄 wrapper（「conflict → 报告，不猜」路由），`doc-link` 是其上的 gate 面（[`src/gate-check.ts`](src/gate-check.ts)，归责谓词 + 锚点修复提示），`md-metadata` 是 change-set 消费型 gate 面（[`src/metadata-check.ts`](src/metadata-check.ts)）。**单拷贝不变量**：工具与 gate 共享同一链接算法、同版本演进。

## 模型面

| 面 | 类型 | 语义 |
|---|---|---|
| `md_rename` 工具 | 写 integrity | 显式 `oldPath → newPath`（工作区根相对）→ `planRename` 冲突则报告拒改 / 否则 `applyRenamePlan`（`git mv` + 写回 edit） |
| `doc-link` gate | 轮末/手动检查 | 全量 + 轮末归责过滤（只报本轮可归责文件的坏链）；gates 缺席时软加载不注册 |
| `md-metadata` gate | 轮末/手动检查（defer） | change-set 消费：本轮被写 md 缺非空 `description` 即失败；不打断 turn，派 subagent fixer 离线补写，下轮重扫到通过 |

文档入口：[docs/README.md](docs/README.md)——库契约文档：[docs/links-lib.md](docs/links-lib.md)（API/边界/fork 同步义务）；gate 注册面文档：[docs/doc-link-gate.md](docs/doc-link-gate.md)。

> 附加出口：不想装 markdown 行、但单个仓库仍想要链接门禁的项目，可在该仓库 `gates.yml` 里 `module: '@catheadowl/dsh-extras/markdown/gate-check'` 声明仓库级回退（同一份 `check` 实现；与插件级注册互斥）。适用条件与形态见 [docs/doc-link-gate.md](docs/doc-link-gate.md)「两种接入形态」。

## 装入

装 extras 包：`dsh plugin add @catheadowl/dsh-extras`（或本地目录变体 `dsh plugin add <extras 目录绝对路径>`，以及 `dsh plugin --profile web add`）；加载后 `md_rename` 出现在模型工具面、`doc-link` 与 `md-metadata` 进入轮末门禁。

构建、测试与 E2E 见 [docs/development.md](docs/development.md)。

## Model experience

- 调用方只给显式 `oldPath → newPath`，无需（也无法）传检测类参数；移动后由工具保证仓库内全部 Markdown 引用仍可解析（入链改写 + 出链 rebase）。
- 确定性优先：不做内容猜测。git 能见证的 rename（staged R / D+shifted / HEAD 条目）才走链接修复-only 路径，否则执行完整移动 + 改写。
- 冲突（目标已存在 / 源缺失 / 路径越出仓库 / 无法确定性改写的链接）时整单拒绝并给出 remedy 提示——**不猜、不部分执行**，由 agent 决策后重试。

## Limitations

- 只管 Markdown 链接；其他格式（代码内 import 路径、HTML、canvas 等）不在此工具 scope。
- 已断链、外部/绝对目标、含不可表示字符的 rebase 目标会被跳过并报告，不猜测修复。
- 依赖 git 工作树作为状态；非 git 环境不可用。
