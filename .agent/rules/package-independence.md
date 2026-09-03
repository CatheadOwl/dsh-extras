---
description: extras 包独立性 rules seed（PKG-1..5）——发布文档自包含、路径包内解析、中性示例命名空间等期望形态；生成时控制写作、评审时原样嵌入 dispatch prompt
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
