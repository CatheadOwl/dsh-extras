---
description: extras 包独立性 rules seed（PKG-1..9）——发布文档自包含、路径包内解析、中性示例命名空间、视角正确性等期望形态；生成时控制写作、评审时原样嵌入 dispatch prompt
---

# extras · package-independence rules

包独立性目标的 **rules SSOT seed**，双端消费：生成时（经 `AGENTS.md` 指针加载）
控制写作；评审时（review 技能的 dispatch prompt **原样嵌入**本文件）对照，
finding 引用 rule id。规则只写期望形态；理由归认知层/决策史。id 一经评审/gate
引用即不改号，作废标「已废弃」不复用。

- **PKG-1〈self-contained-docs〉**：发布文档自包含——README/docs/eval 只链包内
  路径；引用包外来源只写名字（"upstream doc"、"original design record"），
  不写路径指向。
  探针：`grep -rE '\]\(\.\./' <包根>`（越出包根的相对链接）。基线：should-fix
  （发布物断链为 blocker）。
- **PKG-2〈paths-resolve-in-package〉**：文档 prose 中的相对路径 token 在包内
  解析；逃逸与悬垂形态由 `scripts/verify-publish-readiness.mjs`（docs locality）
  判失败；gate 判不了的形态回到本文件裁量。
  探针：`pnpm run verify-publish-readiness`。基线：should-fix。
- **PKG-3〈neutral-example-namespaces〉**：示例数据用中性命名空间
  （`guides/`、`notes/x.md`），不用任何真实仓库的命名空间——示例不得被误读
  为引用。惰性 fixture 字符串（测试/eval 自建场景）不算示例，不违规。
  基线：should-fix。
- **PKG-4〈comments-functional-only〉**：源码注释只带功能语义；设计归因
  （为什么这样设计、决策出处）归认知层，不进注释。
  探针：`verify-publish-readiness` 的 META_TERMS（comment 行词表）。基线：nit。
- **PKG-5〈host-borrow-exemption〉**（豁免条）：`deepseek-harness` checkout
  路径与 `@deepseek-ai/*` 宿主包在 **dev-time 接线**中合法——运行时由 dsh
  宿主提供，publish gate 携带对应豁免。repo 拆分时的随迁义务见开发仓库
  release-plan（纯文本引用）。本条是 PKG-1/2 的显式豁免，不是独立要求。
- **PKG-6〈no-control-plane-narrative〉**：包内文档不承载开发仓控制面叙事
  （状态板、TODO/roadmap、评审运行记录、workunit 故事）与开发仓专属操作
  指示；引用开发仓证据只写名字（不带 id 与控制面词汇）。
  探针：`pnpm run verify:publish-readiness`（源码注释域 META_TERMS + 发布
  文档域 DOC_META_TERMS——ADR/RFC/PRD id、W 线 id、workunit 引用）。
  基线：should-fix。
- **PKG-7〈no-committed-artifacts〉**：构建/运行产物不入 git——`lib/`、
  `eval/.runs/`、`*.tgz`、sourcemap，以及编译器**就地发射**到 `src/` 的
  `.js`/`.d.ts`（绕过 `lib/` 形态 ignore 规则的变体）均按 ignore 策略排除。
  探针：`git ls-files | grep -E 'lib/|\.runs/|\.tgz|\.map$'`。基线：should-fix
  （发布污染为 blocker）。
- **PKG-8〈ssot-direction〉**：SSOT 方向——包消费者需要的实质（契约、配方、
  类型语义）以**包内**为权威（模块文档自权威，开发仓对应 spec 冻结为决策
  记录）；仅决策史（为什么、演进）留开发仓。反向：模块内实现实质不得滞留
  开发仓文档。基线：should-fix。
- **PKG-9〈provider-perspective〉**：视角正确性——承载面模块不枚举消费者
  清单（消费者注册什么由各消费者自己的文档负责）；发布时点叙事（首发/
  首批 lineup、升格/迁移沿革）不进活跃文档；验收示例不预设特定消费者在场。
  探针：`pnpm run verify:publish-readiness`（docs 域沿革动词 DOC_META_TERMS：
  升格/已归档/原仓库级/薄 shim）+ `grep -rnE '首发|首批' <发布面>`（命中
  人工裁决）。基线：should-fix。

## intentional-design 豁免清单（防误报；finding 引用本清单即非 finding）

评审者注意：以下为刻意设计，不是缺陷——

- imperative 入口保留全限定 register 名（内部自洽，改名收益低）；
- Context 增强（如 `ctx.promptMiddleware`）刻意不公开导出（软依赖设计）；
- 单 path resolve 抛错丢同 provider 兄弟 path（继承 imperative 语义，文档已述）；
- `eval/` 目录刻意不随包发布（`files` 不含）；引用它的文档必须纯文本化；
- subagent/client 行保持相对路径 specifier（specifier 化未验证）；
- dev-time 宿主 checkout/junction 接线是 host-borrow 例外（见 PKG-5）；
- gates README 保留命名沿革注记（旧称对照），是刻意教学；
- 「原始决策记录存于开发仓库…（纯文本引用）/ 名称引用」类出处句式是
  PKG-6/PKG-8 的接受形态——豁免条件是不带决策记录 id 与沿革动词；
  fenced 代码块与内联代码里的 token（fixture/标识符）由探针豁免。
