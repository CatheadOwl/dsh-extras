---
description: gates 的可运行参考实现目录——冻结标本（不随活代码演进），首件为 md-metadata 的 module 形态原脚本；文档面在 docs/，本目录只放能被 gates.yml module: 直接加载的代码
---

# examples/

gates 的**可运行参考实现**（docs-as-code）：这里放能被 `gates.yml` 的 `module:`
直接加载的完整检查脚本，作为 [docs/adding-a-repo-gate.md](../docs/adding-a-repo-gate.md)
教学配方的配套标本。散文文档在 [`docs/`](../docs/README.md)，本目录只放代码。

## 冻结声明

本目录的文件是**冻结标本**：展示某个形态的完整写法，不随活代码演进。活的数据面
在相应模块的 `src/`（演进、修 bug 都去那里）；这里的分叉是 by-design，不回灌。
防 bitrot：`test/examples.test.mjs` 会 import 每个标本跑冒烟 case。

## 首件：md-metadata（module 形态）

[md-metadata/module-form.mjs](md-metadata/module-form.mjs)——「会话被写 md 必须带
非空 frontmatter `description`」检查的 module 形态参考实现。Lineage：原开发仓库根
`scripts/md-metadata-lib.mjs`（仓库级 `gates.yml` 条目的数据面，defer-bypass probe
的观测对象），2026-09-02 检查升插件级（`@catheadowl/dsh-extras` md 模块
`src/metadata-check.ts` + `registerGate`）后原样冻结迁入此处。

在自己的仓库使用（照抄需换 id——`md-metadata` 已被插件级注册占用，撞名即报错）：

```yaml
# <项目根>/gates.yml
gates:
  - id: note-metadata                 # 换一个不撞名的 id
    module: vendor/dsh-extras-examples/md-metadata/module-form.mjs
    description: Markdown files written this session must declare a non-empty `description`.
    relevant: ['*.md']
    level: defer
    fixer:
      kind: subagent
      prompt: ...                     # 见 docs/adding-a-repo-gate.md 的 fixer 写法
```
