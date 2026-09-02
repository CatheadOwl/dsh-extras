---
description: gates 自举校验脚本说明——包级共享引擎（extras/scripts/lib）之上本模块仅剩的薄入口（generated reference、docs 导航）与各自的职责、运行方式与 TypeScript 解析约定
---

# scripts/

gates 的**自举校验薄入口**。自 ADR 0001（开发仓库 `workunits/extras/ADR/0001-package-level-bootstrap-gates.md`，纯文本引用）起，通用引擎与包级 gate 上移到包根 `dsh-plugin-dev/extras/scripts/`，本目录只保留 gates 专属的两个入口。它们是项目开发资产，不进入发布包运行时（根 `package.json` 的 `files` 只含 `modules/*/` 产物）。

## 目录结构

```
dsh-plugin-dev/extras/scripts/          # 包级共享（ADR 0001）
  lib/                                  #   通用引擎（参数化，不含任何模块专属配置）
    package-face.mjs                    #     manifest exports + AST 导出面 + 禁止 import 扫描
    api-reference.mjs                   #     generated region 的渲染/重生成/漂移检查
    docs-navigation.mjs                #     docs 树可达性与链接存在性
    resolve-typescript.mjs              #     TypeScript 编译器解析（本地/环境变量）
  verify-package-face.mjs               #   包级 gate：全模块 loader 契约 + 公共入口 facade + 禁止深导入
  verify-publish-readiness.mjs          #   包级 gate：独立发布卫生

modules/gates/scripts/                  # 本目录：gates 专属薄入口
  register-reference.mjs                #   gate 入口 + CLI：generated API reference
  verify-docs-nav.mjs                   #   gate 入口：docs 导航完整性
```

分层原则：**入口脚本只携带模块专属配置**（哪些 source、哪些 docs 路径）并把结果包装成 violation 形状；**lib 引擎只做通用机制**，不知道自己在检查哪个包。其他模块按面接入：有 `docs/` 的模块声明自己的 docs-nav 薄入口（见 `modules/markdown/gates.yml`、`modules/prompt/gates.yml`），有公共消费入口的模块在包级 `verify-package-face.mjs` 的配置表里补行。

## 各入口职责

### register-reference.mjs

`docs/register.md` 的 generated API region 与 `src/register.ts` 实际导出的一致性。一个文件两种用法：

- **gate 面**：`check(root)`（`gates.yml` 的 `register-docs-fresh` 与 `test/face.test.mjs` 调用），漂移时返回 violation，指引跑 `--write`；
- **CLI 面**：`node scripts/register-reference.mjs --write` 原地重生成 generated region。

### verify-docs-nav.mjs

docs 树导航完整性：`docs/` 下每个 markdown 文件必须能从 `docs/README.md` 沿链接到达（孤儿页即违规）、树内链接必须可解析、包 `README.md` 必须链到 docs 入口。

## 包级 gate（声明在 gates.yml，入口在包根）

`gates.yml` 的 `register-face-boundary` 与 `publish-readiness` 指向 `../../scripts/verify-package-face.mjs` 与 `../../scripts/verify-publish-readiness.mjs`——前者守护**整个 extras 包**的消费面（每行组合 entry 只许导出 dsh loader 契约、`./gates/register`/`./client`/`./markdown/gate-check` facade 冻结、禁止绕过 `@catheadowl/dsh-extras/gates/register` 深导入），后者守护**唯一那份根 manifest** 的发布卫生（manifest 规则、import 覆盖、scripts/docs 局部性，`contentRoots()` 枚举全部 `modules/<name>/`）。规则明细见包根 `scripts/` 内两个入口的头部注释与 ADR 0001。

## gate 面契约

每个入口导出统一签名，供 `gates.yml` 的 module gate 与 `node:test` 消费：

```js
check(root) => [{ reason: string, remedy: { kind: 'manual', guidance: string } }]
```

空数组 = 通过。`gates.yml` 声明的 gate 与入口一一对应（见 [../docs/development.md](../docs/development.md)）。

## TypeScript 解析约定

包级 `scripts/lib/resolve-typescript.mjs` 按序解析校验脚本用的编译器：

1. `DSH_TYPESCRIPT_PATH` 环境变量（显式覆盖，指向一个 `typescript.js`）；
2. 从 extras 包可正常 `import('typescript')` 的安装——自有 devDependency 安装，或开发仓库的 `node_modules/typescript` junction（与 `@deepseek-ai/*` peer junction 同一约定，见 [../README.md](../README.md) 的 junction 解析层一节）。

脚本代码里不出现指向宿主 checkout 的路径字面量；越出包根的引用会被包级 `verify-publish-readiness` 的 scripts 局部性规则拦截。

## 参考

- 包级化决策与适用性规则：开发仓库 `workunits/extras/ADR/0001-package-level-bootstrap-gates.md`（纯文本引用，不随包发布解析）。
- 宿主项目的对应实践（docs 生成与漂移校验、package 入口校验）见开发仓库 `deepseek-harness/docs/AGENTS.md` 与 `deepseek-harness/docs/development.md`（纯文本引用）。
- gate 机制本身（`gates.yml` module 形态、`check(root)` 契约）见 [../docs/adding-a-repo-gate.md](../docs/adding-a-repo-gate.md)。
