---
description: prompt-parse 纯库 — user prompt 路径提取的 API、使用范式与开发说明
---

# parse 库（prompt 模块内嵌，`src/parse/`）

user prompt 路径提取纯库（fuzzy / parse / resolve），非插件、非服务、零 dsh
运行时绑定，不单独发布（第二个外部消费者出现时再按抽取规则处理）。能力边界
spec 见开发仓库 workunits（纯文本引用）。

从一段 user prompt 文本里提取「可能是路径」的候选，并对每个候选做 fuzzy 匹配、返回候选路径列表。

**纯库，非插件、非服务、非 hook，零运行时依赖**。它只做提取 + 匹配，**不做决策**：
唯一/太多/放弃、用几条、越界拦截、记忆绑定、event 注入、模型可见时机，都是消费者的事。

**能力边界**：做得到（确定性，不是猜）—— tokenize + 归一化、名字 → 命中位置索引、`total` 三态（0/1/>1）。
做不到（本质限制）—— 区分「指内容 vs 指位置」、把歧义命中（如 `gates`=8、`README`=365）缩到用户想要的那一个；
那需要上下文，是消费者（LLM / 人）的活。本库是它的下游喂料器，不是「路径提取器」。详见
spec「能力边界」（`workunits/prompt-parse/spec/path-extraction-scope.md`，开发仓库纯文本引用）。

## API

包入口 `exports` 暴露两个纯函数 + 一个 composer（都在 `lib/`，编译自 `src/`）：

| 导出 | 来源 | 作用 |
|---|---|---|
| `parsePaths(text, recognizers?)` | `src/parse.ts` | 文本 → 路径候选（recognizer 管线；候选带 `kind` 三档） |
| `suggestPathCandidates(candidatePaths, query, cap=5)` | `src/fuzzy.ts` | 单个 query → 候选 `{ matches, total }`（无 `/` 前缀 = 尾段匹配；`/` 前缀 = 根锚定精确整段；`@` 前缀经 `parsePaths` 折算为 `/`） |
| `resolvePromptPaths(text, candidatePaths, options?)` | `src/resolve.ts` | composer：三档 scope + 顶档命中/弃用策略，返回 `ResolvedMention[]` |
| `ProjectRelativePathRecognizer` | `src/parse.ts` | v0 recognizer（可作新增 recognizer 的参考形状） |
| 类型 `PathCandidate` / `PathKind` / `PathRecognizer` / `PathCandidateMatches` / `ResolvedMention` / `ResolvePromptPathsOptions` | — | 结构契约 |

## 使用范式

**推荐直接用 composer**（承载三档 + 顶档命中/弃用策略）：

```ts
const mentions = resolvePromptPaths(text, candidatePaths, { maxDepth: 2, ambiguityThreshold: 5 })
const paths = mentions.flatMap((m) => m.resolved)
```

`resolvePromptPaths` 内部策略（`total` 为真实命中数）：

| `total` | 结果 |
|---|---|
| 0 | `resolved: []`（无命中，不给提示） |
| `1 ≤ total < ambiguityThreshold` | `resolved` = 顶档：与顶命中在叶名精确度+depth 上并列的全部命中 |
| `total ≥ ambiguityThreshold` | `resolved: []`（歧义太重，不给提示） |

`matches` 与 `resolved` 都经**相关性排序**（三级、稳定）：①叶名精确命中优先 ②depth 升序（离根越近越前）③输入序。排序在 composer（`resolve.ts`），`suggestPathCandidates` 仍按输入序返回（纯、不关心相关性）。`resolved` 与 `cap` 解耦（`cap<1` 只让 `matches` 为空，不丢 `resolved`）。`resolved` 取「与顶命中在①②档并列」的整档，③输入序只排顺序、不淘汰并列——同名同深度并列（裸词 `md-fabric` → `workunits/md-fabric/` + `dsh-plugin-dev/md-fabric/`）两条都进，终选交给消费方。两例：裸词 `docs` 命中根级 `docs/` 与 `deepseek-harness/docs/`（叶名均精确，depth 分开）→ 顶档只有 `docs/`；裸词 `gates` 命中 `gates.yml`（浅层但去扩展名）与 `dsh-plugin-dev/gates/`（较深但叶名精确）→ 顶档 `dsh-plugin-dev/gates/`。

要全量 `{ matches, total }` 自决时，用底层原语（`parsePaths` → `suggestPathCandidates`），工具不替你决策。

**两种一等输入形态**（都以仓库根为解析基准，库不换空间）：

| 形态 | 例子 | 匹配语义 |
|---|---|---|
| project-root 相对（裸格式） | `handbooks`、`workunits/md-fabric` | 尾段匹配 + 裸词深度限定 + 歧义阈值（猜词机制） |
| 根锚定（`/` 前缀，agent 引用根锚，术语辨析 Root-relative path（`docs/designs/Root-relative_path.md`，开发仓库纯文本引用）） | `/workunits/md-fabric`、`/README.md` | **根锚定精确整段**：`/README.md` 只命中根级 `README.md`（全仓同名不再是障碍），`/md-fabric` 在根级不存在时 `total=0`（诚实信号，不尾段回退、不去扩展名） |
| 根锚定（`@` 前缀，宿主 GUI workspace 引用，SSOT `FILE_REFERENCE_PROMPT`） | `@workunits/md-fabric/`、`@README.md`、`@"docs/design notes.md"` | 与 `/` 拼写等价：`@` 在归一化折算为 `/`（ADR 0004），同一根锚定精确整段 |

`candidatePaths`（project 路径列表，**文件 + 目录**）由消费者提供；本库不做文件系统扫描。目录候选建议带尾斜杠（`handbooks/`），这样尾斜杠 specifier（`kind:'dir'`）才能只取目录；否则回退全树（尽力而为）。附带：裸词 `handbooks` 去扩展名副作用仍会命中同名文件 `handbooks.md`。

## 归一化规则（v0）

`parsePaths` 产出的 `normalized` 字段做了：`\` → `/`、去 token 首尾空白与配对引号、剥前导 `./`、剥尾随标点（`,` `;` 及句末单独 `.`，`..` 保留）、尾斜杠剥除标 `kind:'dir'`。`../` 保留（越界拦截是消费者的事）。**前导 `/` 保留**——它是 repository-root-relative 引用锚（agent 引用根锚），matcher 据此做根锚定精确整段匹配（`/handbooks/` → `normalized: '/handbooks'` + `kind:'dir'`）。**前导 `@` 折算为 `/`**——它是 workspace 引用锚（宿主 GUI `FILE_REFERENCE_PROMPT`），与 `/` 是同一根锚的两种拼写（`@workunits/md-fabric/` → `normalized: '/workunits/md-fabric'` + `kind:'dir'`）。

## Recognizer 管线（可扩展）

```ts
interface PathRecognizer {
  name: string
  scan(text: string): PathCandidate[]
}
```

`parsePaths(text)` 默认用 `[new ProjectRelativePathRecognizer()]`，结果按 `start` 排序（稳定）。新增输入形态 = 新增一个 recognizer 传入，**不动主干**。

v0 `ProjectRelativePathRecognizer` 提取：带 `/` 或 `\` 的 token、裸 `word.ext`、code span 内部（`` `src/x.ts` ``，含空白的 code span 跳过）、引号内部（`"docs/design notes.md"`，引号是含空格路径的分隔符）、`@` 前缀 workspace 引用（`@path`、`@path/`、`@"path with spaces"`，折算为 `/` 根锚）、所有裸词（方案 A）。排除 email（`a@b.test`）与 URL（`https://…`）。

## 边界 / 非目标

- 不做文件系统扫描（`candidatePaths` 由消费者喂入）。
- `candidatePaths` **必须 gitignore-aware**：不能复用宿主的 `WorkspaceFileSearch`（非 gitignore-aware、有界、top-20），接入层须自带枚举，见 spec「接入结论」。
- 不做决策（唯一/歧义/弃用）。
- 不处理文件系统绝对路径（`C:\…`）——这是别的 seam / 消费者的职责。`/x/y` 不是文件系统绝对路径，是**仓库根相对**（文档链接标准）；`@x/y` 是** workspace 引用**（宿主 GUI 标准格式），两者本库都一等支持、归一化到同一根锚。

## 开发

测试跑**编译后 `lib/`**（`node:test` + `node:assert`，无框架依赖），所以先 build 再 test：

```powershell
# 从 extras 包根；tsc 借用 dsh 宿主检出的工具链（见包根 README 开发节）
pnpm run check-types:prompt    # 含本库
pnpm run build:prompt
pnpm run test:prompt           # 含 fuzzy / parse / resolve 三套
```

或在本目录跑 `pnpm run verify`（= check-types → build → test）。`lib/`、`node_modules/` 已 gitignore。

测试用例：`test/fuzzy.test.mjs` 移植自 CogGit `pathHints.test.ts`（段后缀、无点叶子去扩展名、隐藏文件、去重、cap 截断）并适配 exact-命中 + `{matches,total}`；`test/parse.test.mjs` 对齐 spec case 表（email/URL 排除、引号、code span、`\`→`/` 归一化）；`test/resolve.test.mjs` 对齐三档范围 / 阈值策略 / 相关性排序（叶名精确→depth→输入序）+ 候选去重（去重一次、不重复计数）。
