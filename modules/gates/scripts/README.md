---
description: gates 自举校验脚本说明——四个 gate 入口（register face、generated reference、docs 导航、publish readiness）与 lib 通用引擎的职责、运行方式与 TypeScript 解析约定
---

# scripts/

gates 的**自举校验脚本**：用 gates 自己的机制守护 gates 包的消费面与发布卫生。它们是项目开发资产，不进入发布包运行时（`files` 只含 `lib/` 产物与 `cordis.patch.yml`）。

## 目录结构

```
scripts/
  verify-register-face.mjs      # gate 入口：package/导出面边界
  register-reference.mjs        # gate 入口 + CLI：generated API reference
  verify-docs-nav.mjs           # gate 入口：docs 导航完整性
  verify-publish-readiness.mjs  # gate 入口：独立发布卫生
  lib/                          # 通用引擎（参数化，不含 gates 专属配置）
    package-face.mjs            #   manifest exports + AST 导出面 + 禁止 import 扫描
    api-reference.mjs           #   generated region 的渲染/重生成/漂移检查
    docs-navigation.mjs         #   docs 树可达性与链接存在性
    resolve-typescript.mjs      #   TypeScript 编译器解析（本地/环境变量）
```

分层原则：**入口脚本只携带 gates 专属配置**（哪些 entry、哪些 facade 导出、哪些 docs 路径）并把结果包装成 violation 形状；**lib 引擎只做通用机制**，不知道自己在检查哪个包。其他 dsh 树外插件可以复制 `lib/` 并写自己的入口配置。

## 各脚本职责

### verify-register-face.mjs

守护包的消费面边界：

- `package.json` `exports` 必须恰好是 `.`、`./register`、`./client`、`./package.json`，且每个入口带 `types` + `default` 条件；
- root entry（`src/index.ts`）只许导出 dsh loader 契约（`name`/`inject`/`Config`/`apply`），多一个符号即违规；
- `src/register.ts` 只许导出 `registerGate` 与 gate contract types（facade 清单写在脚本里，新增公共导出必须同步这里）；
- 扫描 `src/`、`docs/` 中的禁止 import 模式（如绕过 `@catheadowl/dsh-extras/register` 深导入本包其他入口）。

### register-reference.mjs

`docs/register.md` 的 generated API region 与 `src/register.ts` 实际导出的一致性。一个文件两种用法：

- **gate 面**：`check(root)`（`gates.yml` 的 `register-docs-fresh` 与 `test/face.test.mjs` 调用），漂移时返回 violation，指引跑 `--write`；
- **CLI 面**：`node scripts/register-reference.mjs --write` 原地重生成 generated region（`package.json` 的 `generate:docs`）。

### verify-docs-nav.mjs

docs 树导航完整性：`docs/` 下每个 markdown 文件必须能从 `docs/README.md` 沿链接到达（孤儿页即违规）、树内链接必须可解析、包 `README.md` 必须链到 docs 入口。

### verify-publish-readiness.mjs

独立发布卫生，五组规则：

| 规则 | 拦截什么 |
|---|---|
| manifest | `"private": true`；`dependencies` 里的非 registry specifier（`link:`/`file:`/`workspace:`/路径）；`@deepseek-ai/*` 宿主包出现在 `dependencies`（只能走 peerDependencies） |
| devDeps | `devDependencies` 的 `link:`/路径 specifier 只允许 `@deepseek-ai/*` 宿主包 |
| import 覆盖 | `src/` 里每个裸 import 必须声明在 dependencies ∪ peerDependencies |
| scripts 局部性 | `scripts/` 的 import 与 `new URL('...')` 路径不得越出包根；裸 import 必须是 node builtin 或已声明依赖 |
| docs 局部性 | `README.md`、`docs/`、`eval/` 的 markdown 链接不得越出包根、不得用绝对仓库路径（fenced code 块豁免） |

包根之外的证据引用写成纯文本路径（可 grep、不可点）。

## gate 面契约

每个入口导出统一签名，供 `gates.yml` 的 module gate 与 `node:test` 消费：

```js
check(root) => [{ reason: string, remedy: { kind: 'manual', guidance: string } }]
```

空数组 = 通过。`gates.yml` 声明的四个 gate 与入口一一对应（见 [../docs/development.md](../docs/development.md) 的「自举 gates」）。

## TypeScript 解析约定

`lib/resolve-typescript.mjs` 按序解析校验脚本用的编译器：

1. `DSH_TYPESCRIPT_PATH` 环境变量（显式覆盖，指向一个 `typescript.js`）；
2. 从本包可正常 `import('typescript')` 的安装——自有 devDependency 安装，或开发仓库的 `node_modules/typescript` junction（与 `@deepseek-ai/*` peer junction 同一约定，见 [../README.md](../README.md) 的 junction 解析层一节）。

脚本代码里不出现指向宿主 checkout 的路径字面量；越出包根的引用会被 `verify-publish-readiness` 的 scripts 局部性规则拦截。

## 参考

- 宿主项目的对应实践（docs 生成与漂移校验、package 入口校验）见开发仓库 `deepseek-harness/docs/AGENTS.md` 与 `deepseek-harness/docs/development.md`（纯文本引用，不随包发布解析）。
- gate 机制本身（`gates.yml` module 形态、`check(root)` 契约）见 [../docs/adding-a-repo-gate.md](../docs/adding-a-repo-gate.md)。
