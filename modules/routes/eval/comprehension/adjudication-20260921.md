---
description: 2026-09-21 comprehension judge 8 条新发现的逐条裁决——6 design（5×(a) 工具描述、1×(b) 有意设计）+ 2 fixture（(c) prompt 措辞），含改动清单与复跑验收
---

# Adjudication — 2026-09-21 comprehension judge findings

证据基线：当次 `.runs/any-routes-comprehension/`（judge.json / review-report.md，gitignore 的当次产物）。judge 的 suspected source 标注是初值不是结论，本文是裁决。逐条三选一：(a) 改输出面/工具描述（产品修复）；(b) 归入 intentional design（进 rubric known-intentional 清单）；(c) fixture 伪影（修 fixture/prompt）。

**裁决分布**：#1–#5 = (a)，全部落在工具描述文档面（无输出 schema / 行为变更）；#6 = (b)；F1/F2 = (c)。工具描述现为 272 词，超出 TD-4 软上限（~150 词）——五个新子句各自消解一条本文件裁决的误读，是 TD-4 允许的超限口径。

## #1 `anchor` 是未文档化的响应字段 — (a)

**理由**：`anchor` 是承重字段而非冗余——`routePath` 未命中且唯一提示自动改投时，它反映 `resolvedRoutePath` 解析后的真实扫描根，是 `depth` 起算点的地面真值（两个 reviewer 把它读成「root+routePath 拼接」恰是没看到这层）。它是两个 run 唯一共同 uncertain 的 rubric 项，缺口在文档面：描述只讲了行语法与计数，从没讲响应封套。
**改动**：`ANY_ROUTES_DESCRIPTION`（src/tool-description.ts）加不变量句——`root` 是 workspace 绝对根、`anchor` 是本次视图的绝对路由根、`depth` 从 `anchor` 起算；description-contract 测试钉住该子串。

## #2 过滤参数在输出中不回显 — (a)，文档面

**理由**：唯一可能「静默截停」的 `maxFiles` 本就响亮——`collectMarkdownFiles` 的 FileLimitState 注释明言 "a route view must never silently drop entries"，命中即报 `file-limit-reached` 诊断且有测试锁定；排除项（excludeDirs / excludeFiles / dot 条目 / gitignore）是调用方与插件配置所有的策略，回显五项 = 每次调用加热路径噪音、收益归零（调用方已拥有该状态）。真缺口是消费者无法区分「不存在」与「被排除」——用文档闭合：缺失即被策略排除或不含 Markdown，唯一中途截停必报诊断。
**改动**：工具描述加过滤可见性句（apply without an echo + `diagnostics` 响亮通道）；`any-routes.review.mjs` 的 `projectResult` 补投影 `diagnostics`，让描述提到的通道在观察素材里可见；rubric per-field 键加 `diagnostics` 行；docs/routes.md 遍历边界节加「过滤不回显」条、maxFiles 条补诊断说明。
**否决的替代**：judge Next step 建议的「echo effective filter state」——不加 `appliedFilters` 之类回显字段（schema 变更 + 每调用噪音 + 无消费者收益）。

## #3 flat 的 ` | ` 描述分隔符无转义/语法 — (a)，文档面

**理由**：flat 行是单字符串，描述必须内嵌；定义「行内**第一个** ` | ` 切分、其后内容（含更多 ` | `）均属描述」即为完备消费语法，转义语法给人与模型都加解析负担。残留：路由路径本身含 ` | ` 的病态情形不设防——该字符在 Windows 文件名非法、策展 Markdown 知识库不出现，防御成本高于风险，记为接受残留（不宣称受保证的不变量之外的承诺）。
**改动**：工具描述加切分语法句；description-contract 钉住；docs/routes.md 路由视图规则节同步。

## #4 description 提取来源未说明 — (a)，文档面

**理由**：`extractDescription` 的三级优先（frontmatter `description:` → 文档头部显式 `description:` 行 → 首个实质正文行）是既定且确定的行为，一句话可述；不说明则消费者无法预判描述何时出现、是策展摘要还是回退正文。注意：这推翻了 schema-intent rubric accepted-intent #2 的旧立场（「schema 不说来源是刻意的，模型只需 presence/absence」）——该立场服务于工具选择面，comprehension 证据（run 2 明确标 unknown provenance）表明理解返回物需要来源；两全做法：一句话给来源，不给提取算法细节。
**改动**：工具描述加来源句；schema-intent rubric accepted-intent #2 改写为新立场；description-contract 钉住；docs/routes.md 同步。

## #5 空目录 / N=0 / 只含非 .md 文件目录的边界 — (a)，文档面

**理由**：行为已定且确定：`describeTruncatedDir` 只在 `markdownCount > 0` 时入表（`collectMarkdownFiles` 深度边界分支），即完全不含 `.md` 的文件夹整体省略、`[truncated: 0]` 不存在——Markdown 路由器不路由无 Markdown 内容，是有意的 omission，缺口仅在未述。fixture 无法演示该行为（该文件夹不出现在输出里，输出面不可见），文档声明是唯一修复面。
**改动**：工具描述在截断行语法后补空文件夹省略句；rubric per-field 键 `[truncated: N]` 行同步；description-contract 钉住；docs/routes.md「只收 `.md`」条同步。

## #6 flat `[truncated: N]` 与 tree `omittedMarkdownCount` 一概念两名 — (b)

**理由（接受的取舍）**：两名是两种投影形态的自然结果——flat 行是字符串，N 必须活在前缀里；tree 节点是对象，用命名字段。两个 reviewer 都已正确理解两种拼写（此条没有造成任何 uncertain，只是一致性观感），重命名已发布的 tree 字段是破坏性 schema 变更、零理解收益。
**改动**：`format` 参数描述加交叉引用（`omittedMarkdownCount` = "the same recursive .md total as flat's `[truncated: N]`"，src/index.ts 与冻结副本同步）；rubric known-intentional 清单加第 12 条记录该取舍。

## F1 hop-3/4 冗余（记录轨迹非最小） — (c)

**理由**：judged fixture 的轨迹选择问题，非插件缺陷——reviewer 的观察（hop-2 已见目标、hop-3 是确认性下钻、hop-4 是回跳的格式演示）是正确理解而非误读，被 premise 措辞人为变成了「不一致」。
**改动**：prompt.md 首段改为如实描述序列（三个 flat hop 走向目标 + 第四次调用以 tree 重渲染第二跳范围）；rubric known-intentional 加第 13 条（记录轨迹是 fixture 选择；工具本就接受任意 folder route 直达，不欠「最短路径」指引）。

## F2 "three successive hops" 与四个输出不符 — (c)

**理由**：prompt 前提与素材数量不一致的人为矛盾，与 F1 同根同修。
**改动**：随 F1 的 prompt.md 改写一并消除。

## 连带修复（同步义务，非裁决项）

- eval/comprehension/fixtures.json 的 tool 冻结副本相对 SSOT 已漂移（缺 `excludeFiles` 参数、`excludeDirs` 措辞为旧版）；本次随描述变更一并同步（TD-1 镜像随 SSOT，即 EVAL-009 登记的漂移风险面的一次兑现）。

## 复跑暴露的后续项（每轮修复让 reviewer 读得更细，逐条同口径裁决）

裁决分布：R1–R3 = (a)（均为输出面字段枚举/封套说明的措辞完备性，无 schema/行为变更）；R4/R6 = 有意设计（known-intentional 已覆盖，judge 漏映射）；R5/R7/R8 = 接受的残留（假设性输入或既有文档行为，无动作）。

- **R1 tree 参数把 `markdown` 写成无条件存在（复跑 1 flag 1）— (a)**：guide 无 README 时该字段缺席，参数枚举措辞与输出不符。改：`markdown` (its README path, when it has one)。
- **R2 `routePath` 回显未入响应封套说明（复跑 1 flag 2）— (a)**：anchor 句只讲 root/anchor/depth。改：补 "and the requested `routePath` is echoed when one was passed"。
- **R3 tree 字段枚举漏 `description`（复跑 2 flag 1，两 run 共同）— (a)**：hop-4 截断文件夹节点实际带 `"description"`，format 参数枚举未列。改：补 `description` (that README's, when the README has one)。
- **R4 flat/tree 对截断文件夹信息不对称（复跑 2 flag 2）— (b) 无新条目**：known-intentional 第 10 条已覆盖（`markdown` 只在 tree）；judge 本轮漏映射，前次判读曾正确归并到第 10 条。
- **R5 `routePath` 传 `./explorer`、`explorer/` 时回显行为未述（复跑 2 flag 3）— 接受残留**：参数已规定规范形（slash-separated folder paths）；非规范输入超出演示面。代码事实：`normalizedRoutePath` 规范化后回显规范形。处置：rubric per-field 键 `routePath` 行补 "echoed in normalized slash form"，不加描述子句。
- **R6 `omittedMarkdownCount` 含已被 README 代表的文件（复跑 2 flag 4）— (b) 无新条目**：known-intentional 第 1 条已覆盖（N = 递归 .md 总数，与观察根无关）；命名观感问题，judge 自评 non-blocking。
- **R7 无描述文件无法区分「规则下无描述」与「提取失败」（复跑 2 flag 5）— 接受残留**：来源规则已述（都不命中则无描述）；读取失败另有 `unreadable-file` 诊断响亮化，不与「无描述」混淆。
- **R8 flat 无法区分「无 README」与「README 无描述」（复跑 3，两 run 共同；judge Next step 即建议入清单）— (b)**：known-intentional 加第 14 条——flat 单字符串无字段是既定设计，tree 的 `markdown` 是命名字段消歧器，两种情形导航后果相同。
- **R9 省略 `routePath` 与传 `"."` 的回显差异未演示（复跑 3 flag 2，judge 自评 non-actionable）— 接受残留**：代码事实是可区分的——传 `"."` 时 `routePath: "."` 照样回显（requestedRoutePath 为真值），省略时字段缺席；fixture 未演示，无行为后果，不改。

## 验收（复跑）

复跑 `dsh-review --judge --runs 2`（profile=headless），comprehension 共三轮（每轮修复后验证）、schema-intent 一轮：

- **schema-intent**：status=judged；两 run 均 3/3 场景正确、零 missed / 零 uncertain、答案逐字一致；New red flags = None；judge Next step = No action。
- **comprehension 终轮**：status=judged；两 run Part 1 字段**全部 understood**（含本轮裁决目标 `anchor`、`diagnostics`、`[truncated: 0]` 规则、description 来源与首分隔符切分——分隔符规则被 reviewer 正确复述）；全部 hop 动作符合键；judge 结论语 "no missing/comprehension-broken field in either run"，"every flag maps to an intentional/documented item"。
- 终轮剩余 flag 的处置：R8 入 known-intentional 第 14 条（judge 建议的 rubric 增补）；R9 记录接受残留（judge 自评 non-actionable）。
- 中间轮次（复跑 1/2）的 R1–R3 修复后已在后续轮次验证消失。
- **未验证项（响亮记账）**：R8/#14 的 judge 归并闭环未经第四次复跑验证——本轮以裁决关闭（rubric 只进 judge 输入，终轮后 reviewer 可见面未再变，复跑只能验证 judge 的映射）；留待该模块下次 review 使用时顺带确认：reviewer 再 flag flat 无 README 歧义时，judge 归并到 known-intentional 14 而非再列为新 red flag。
- **阈值下观察（无动作）**：终轮 judge 在 Verdicts 分歧注记提到一个 run 的 hop-3 未明说「用 read 取目标内容」（route-only 边界仍被承认），自评为 minor、未列为 flag——观察在档，不动产品面。
- 模块测试 50/50 全绿（含 5 条新 description-contract 钉子）；`check-types:routes`、`build:routes` 通过。
