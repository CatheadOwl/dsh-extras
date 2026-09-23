---
description: gates 自举校验脚本说明——包级共享引擎（extras/scripts/lib）之上的分层结构与各自职责、运行方式与 TypeScript 解析约定
---

# scripts/

gates 的**自举校验**说明。自「extras 包级自举 gates」的原始决策记录（ADR 按名，存于开发仓库）定下分层起，通用引擎与包级 gate 上移到包根 `dsh-plugin-dev/extras/scripts/`。本目录原有的 gates 专属薄入口 `register-reference.mjs`（register 面 API reference 再生成）已随 register 面回撤删除（2026-09-23），目录只剩本文档。脚本是项目开发资产，不进入发布包运行时（根 `package.json` 的 `files` 只含 `modules/*/` 产物）。

## 目录结构

```
dsh-plugin-dev/extras/scripts/          # 包级共享（ADR 0001）
  lib/                                  #   通用引擎（参数化，不含任何模块专属配置）
    package-face.mjs                    #     manifest exports + AST 导出面 + 禁止 import 扫描
    api-reference.mjs                   #     generated region 的渲染/重生成/漂移检查
    docs-navigation.mjs                #     docs 树可达性与链接存在性
    resolve-typescript.mjs              #     TypeScript 编译器解析（本地/环境变量）
  verify-package-face.mjs               #   包级 gate：全模块 loader 契约 + 公共入口 facade + 禁止自引用深导入
  verify-publish-readiness.mjs          #   包级 gate：独立发布卫生
  verify-docs-nav.mjs                   #   包级 gate：遍历全部 docs-owning 模块的导航完整性

modules/gates/scripts/                  # 本目录：已无脚本（register-reference.mjs 随面回撤删除）
```

分层原则：**入口脚本只携带模块专属配置**（哪些 source、哪些 docs 路径）并把结果包装成 violation 形状；**lib 引擎只做通用机制**，不知道自己在检查哪个包。其他模块按面接入：有 `docs/` 的模块由包级 `verify-docs-nav.mjs` 的模块表覆盖（新增 docs-owning 模块时在该表补行），有公共消费入口的模块在包级 `verify-package-face.mjs` 的配置表里补行。

## 各入口职责

### 包级 verify-docs-nav.mjs

docs 树导航完整性：`docs/` 下每个 markdown 文件必须能从 `docs/README.md` 沿链接到达（孤儿页即违规）、树内链接必须可解析、模块 `README.md` 必须链到 docs 入口。包级入口遍历模块表（gates / markdown / prompt），违规带 `modules/<name>:` 前缀定位。

## 包级 gate（声明在包根 gates.yml）

包根 `gates.yml` 声明全部自举 gate：`register-face-boundary` 与 `publish-readiness` 指向 `scripts/verify-package-face.mjs` 与 `scripts/verify-publish-readiness.mjs`——前者守护**整个 extras 包**的消费面（每行组合 entry 只许导出 dsh loader 契约、可选 facade 冻结清单、禁止任何 `@catheadowl/dsh-extras` 自引用 import），后者守护**唯一那份根 manifest** 的发布卫生（manifest 规则、import 覆盖、scripts/docs 局部性，`contentRoots()` 枚举全部 `modules/<name>/`）。规则明细见包根 `scripts/` 内两个入口的头部注释与 ADR 0001。

## gate 面契约

每个入口导出统一签名，供 `gates.yml` 的 module gate 与 `node:test` 消费：

```js
check(workspaceRoot?) => [{ reason: string, remedy: { kind: 'manual', guidance: string } }]
```

空数组 = 通过。入口**按自身文件位置锚定**检查目标（gates runner 传入的会话根作为第一参到达但不参与解析），因此无论会话工作区根在哪一层，检查都指向正确的模块布局。`gates.yml` 声明的 gate 与入口一一对应（见 [../docs/development.md](../docs/development.md)）。

## TypeScript 解析约定

包级 `scripts/lib/resolve-typescript.mjs` 按序解析校验脚本用的编译器：

1. `DSH_TYPESCRIPT_PATH` 环境变量（显式覆盖，指向一个 `typescript.js`）；
2. 从 extras 包可正常 `import('typescript')` 的安装——自有 devDependency 安装，或开发仓库的 `node_modules/typescript` junction（与 `@deepseek-ai/*` peer junction 同一约定，见 [../README.md](../README.md) 的 junction 解析层一节）。

脚本代码里不出现指向宿主 checkout 的路径字面量；越出包根的引用会被包级 `verify-publish-readiness` 的 scripts 局部性规则拦截。

## 参考

- 包级化决策与适用性规则：extras 包级自举 gates 的原始决策记录（ADR 按名，存于开发仓库）。
- 宿主项目的对应实践（docs 生成与漂移校验、package 入口校验）见开发仓库 `deepseek-harness/docs/AGENTS.md` 与 `deepseek-harness/docs/development.md`（纯文本引用）。
- gate 机制本身（`gates.yml` module 形态、`check(root)` 契约）见 [../docs/adding-a-repo-gate.md](../docs/adding-a-repo-gate.md)。
