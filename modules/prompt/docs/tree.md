---
description: workspace-tree 纯模块 — gitignore-aware 的 workspace 枚举, 产出 prompt-parse 的 candidatePaths
---

# tree 库（prompt 模块内嵌，`src/tree/`）

从 workspace 根目录枚举出 gitignore-aware 的 project 相对路径列表（目录带尾斜杠、文件不带），作为同模块 parse 库（`src/parse/`）的 `candidatePaths` 输入。

**纯模块，非插件、非服务，零 npm 运行时依赖**（`.gitignore` 匹配用 vendored `ignore@5.3.2`，见 `vendor/ignore/README.md`）。它是 prompt-parse spec「接入结论」的落地：prompt-parse 纯库不碰文件系统，`candidatePaths` 由本模块产出。

## API

```ts
async function enumerateWorkspacePaths(root: string, options?): Promise<string[]>
```

- `root`：workspace 根（绝对路径）。
- 返回 project 相对路径；**目录带尾斜杠**（`guides/`），文件不带（`README.md`）。
- 顺序确定性：逐目录按名排序、深度优先。

## 语义

- 逐目录读 `.gitignore`（根 + 嵌套 + 子模块自己的），命中即剪枝（含目录限定 `foo/`、锚定 `/foo`、glob `*`/`**`、同文件内 `!`）。
- 恒跳过 `.git`（仓库元数据目录 / 子模块 `.git` 标记文件）。
- 不跟随符号链接（`Dirent.isFile()/isDirectory()` 对 symlink 均 false）。
- 空目录也会枚举（带尾斜杠）。

## 已知边界

- **跨文件取反不处理**：更深层 `.gitignore` 的 `!` 不能重新包含被浅层 `.gitignore` 忽略的路径（同一文件内的 `!` 由 `ignore` 库正确解析）。本仓库 `.gitignore` 无 `!`，故无影响。
- 无硬编码排除黑名单（除 `.git`）；`node_modules`/`lib`/`coverage` 等全靠各自 `.gitignore`。

## 开发

```powershell
# 从 extras 包根；tsc 借用 dsh 宿主检出的工具链（见包根 README 开发节）
pnpm run check-types:prompt
pnpm run build:prompt
pnpm run test:prompt           # 含 enumerate 套件
```

`lib/`、`node_modules/` 已 gitignore；`vendor/` 是 vendored 源码（提交，勿删）。
