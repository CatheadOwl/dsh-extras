---
description: md-links 纯库槽位——Markdown 链接完整性数据面（mdast 解析 + 字节保真定位 + 文档锚点）
---

# links 库（`src/links/`）— Markdown 链接完整性数据面

把 Markdown 文本解析成可定位的链接与锚点事实，供链接完整性门禁与 rename 工具消费。模块内**纯库**：非插件、非服务、零 dsh 运行时绑定，不单独发布（第二个外部消费者出现时再按抽取规则处理）。

- **第三方依赖**：4 个 mdast 包（`mdast-util-from-markdown` / `mdast-util-gfm` / `micromark-extension-gfm` / `@types/mdast`）声明为 registry `^range`；开发期解析靠指向 dsh 宿主检出的 `node_modules` junction（接线方式见包根 README 开发节）。
- **消费者（包内）**：rename 工具 `md_rename`（`ctx.tools` 薄 wrapper）与 `doc-link` gate（插件级注册，`markdown/gate-check` 兼作 `gates.yml` `module:` 回退面）。工具与 gate 共享同一算法、同版本演进——单拷贝不变量，vendor 两份即两个漂移点。
- **契约不在此**：提升决策史见外部开发笔记（md-links，名称引用）。

## 模块

| 模块 | 来源 | 职责 |
|------|------|------|
| `markdown.ts` | fork（上游 `scripts/markdown.ts`） | 解析缝：GFM 解析（`parseMarkdown`）、树遍历（`visitMarkdown`）、字节保真目的地定位（`markdownDestination`）、URL 切分/外链判定（`splitMarkdownUrlTarget` / `isExternalOrAbsoluteMarkdownUrl`）、标题行（`markdownHeadingLines`） |
| `anchors.ts` | fork（上游 `scripts/verify-md-links.ts`） | 锚点缝：GitHub 标题 slug（`githubSlug`）、文档锚点集（`documentAnchors`）、逐文件锚点缓存（`anchorCache`）；自写扩展 `documentAnchorPairs`（标题 → 精确锚点对，供 remedy hint） |
| `resolve.ts` | 自写（语义对齐上游） | 解析缝之上：`extractReferences`（AST 提取 link/image/definition）、`resolveReference`（逐引用解析，可选 per-scan `TargetProbe` 存在性缓存）、`canonicalPath`（归责规范路径：绝对、`/` 分隔、lexical）、`checkRepository`（整仓校验，可选 `include` 谓词缝；内部建 `targetProbeCache` 去重 5:1 重复目标的存在性探测）；跳过 `//`/`/`/scheme，`#frag` 解析到源文件自身 |
| `rebase.ts` | 自写（宿主只查不改） | rebase 缝：`rebaseDestination`（字节保真目的地改写，只换 path、保留 `#`/`?` suffix） |
| `rename.ts` | 自写（宿主只查不改） | rename 事务内核：`rebaseHref`（document-relative href）/ `planRename` / `applyRenamePlan`（plan-then-apply，工作树绝不半改） |
| `normalize.ts` | 自写（宿主只查不改） | root-relative 归一化：`planRootRelativeNormalization` / `applyRootRelativeNormalization`（`/` 内部链接 → document-relative，补 `resolve.ts` 的 `/` 跳过） |
| `git.ts` | 自写（宿主用 glob，非 git） | git 扫描缝：`gitTopLevel`/`gitLinkPaths`/`gitLsFiles`（gitignore 正确 + gitlink 边界；临时文件捕获规避沙箱管道 EPERM） |
| `index.ts` | — | 公共 `exports` 重导出 |

## 来源区分（fork vs 自写；判定记录见外部开发笔记 fork-vs-self-written ADR，名称引用）

- **fork（copy = fork，上游改动需手工重拷 + 重测）**：`markdown.ts`（fork 自上游 `deepseek-harness/scripts/markdown.ts` 解析原语子集）、`anchors.ts`（fork 自 `deepseek-harness/scripts/verify-md-links.ts` 的 `githubSlug`/`documentAnchors`/`anchorCache`）。不得 import 上游源码（反转依赖，被否决的 A3）。
- **自写（无宿主等价物，本仓测试负责）**：`resolve.ts`（宿主的 `findViolations` 是 gate 编排、非可复用 API，数据面需逐引用 `resolveReference`）、`git.ts`（宿主的 `uniqueRepoFiles` 是 `globSync`、非 git）。自写层的语义仍对齐上游（`/` 跳过、document-relative 解析、fail-closed `%zz`）。
- **丢弃不迁**：md-fabric 的 regex `extractReferences`、regex 锚点版、wikilink、`/` 根相对解析，由 fork 的上游原语取代（判定依据同上：fork-vs-self-written ADR，名称引用）。

## 依赖放置

- `@types/mdast` 在 `dependencies`（非 dev）：`MarkdownDestinationNode = Extract<Nodes, …>` 把 mdast `Nodes` 类型泄漏进公共 `.d.ts`，消费者需要它。
- `@types/node` 在 `devDependencies`：`anchors.ts` 读 `node:fs`，只编译期需要；tsconfig 用宿主约定 `"types": ["node"]`（宿主 `tsconfig.base.json` 同款）。

## 命令

```bash
# 从 extras 包根
pnpm run check-types:markdown
pnpm run build:markdown
pnpm run test:markdown
```

开发期解析说明：依赖声明已是 registry `^range`（发布态），嵌套仓库内**不要** `pnpm install`（会清掉手工 junction 且 peer 404）——开发循环靠既有 `node_modules` junction 过渡解析（声明与解析解耦）。

测试为 `node:test`（编译后 `lib/` 消费），覆盖 `markdown.test.mjs`（解析/定位/切分/标题）、`anchors.test.mjs`（slug/锚点/去重/缓存）与 `resolve.test.mjs`（AST 提取/解析对齐/整仓校验）。
