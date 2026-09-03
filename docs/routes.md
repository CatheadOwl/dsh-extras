# routes 工作细节

`modules/routes` 的两个模型面（`any_routes` 工具与 breadcrumb-description-enricher）的
行为细节：遍历边界、depth 截断语义、diagnostics 含义、路由视图规则，以及开发循环。
模块入口见 [../modules/routes/README.md](../modules/routes/README.md)。

## 遍历边界（traversal boundaries）

- **扫描根**：取自插件配置 `root`（会话 workspace 的子路径，默认 `.`）与会话 cwd
  （`exec.agent.session.header.cwd`）拼接；`routePath` 参数只在该根内选择子目录，
  从不接受根本身作为调用参数。
- **`routePath` 越界即拒绝**：词法上逃出扫描根的 `routePath` 不扫描，产出
  `route-path-escaped` 诊断与空路由表。
- **`routePath` 未命中时给提示**：产出 `pathMissMessage` 与 `pathHints` 候选；恰好
  唯一命中时自动改用该候选（结果里记为 `resolvedRoutePath`），不再提示。
- **跳过的目录名**：默认 `excludeDirs`（`.git`、`node_modules`、`dist`、`build`、
  `lib`、`out` 等），可被插件配置覆盖。
- **dot 条目**：`excludeDotEntries`（默认开）跳过名字以 `.` 开头的条目
  （如 `.github`、`.agents`）。
- **`.gitignore`**：`respectGitignore`（默认开）沿途读取并继承 `.gitignore` 规则，
  命中的路径不进入路由表。
- **`maxFiles`**（默认 2000）：每次调用读取 Markdown 文件数的上限，超出即停止收集。
- **只收 `.md`**：其他扩展名的文件不进入路由表。

## depth 截断语义

- `depth` 从路由根（`routePath` 若给出，否则扫描根）起算，不是从 workspace 根起算。
- 恰好落在 `depth` 边界上的文件夹**不下钻**，渲染为 `[truncated: N] folder-path`，
  其中 N 是该文件夹下递归 `.md` 总数（展开后会出现的总数，与从哪个根观察无关）。
- 截断的文件夹仍由其下一级 `README.md` 代表：浅读该 README 的描述，路由行保留
  ` | description`；无 README 则只有 `[truncated: N] folder-path`。
- `depth: 0`（默认）：只列路由根自身的 Markdown 文件 + 每个直接子文件夹的
  `[truncated: N]` 代表行。

## 路由视图规则（routing view）

- **文件夹**由其下一级 `folder/README.md` 代表——路由行显示文件夹路径 + 该 README
  的描述；**普通 Markdown 文件**显示完整相对 `.md` 路径 + 其描述。
- `format: flat`（默认）：每条一行；`format: tree`：嵌套节点，语义相同——
  文件节点带完整 `.md` `path` 与 `kind: file`；截断文件夹带 `truncated: true`、
  `omittedMarkdownCount`（递归 `.md` 总数）与 `markdown`（其 README 路径）；
  已展开文件夹只有 `path` 与 `children`。
- `routeCount` 计的是路由条目数（Markdown 文件 + 截断文件夹），不是原始 `.md` 数。

## diagnostics 含义

结果顶层的 `diagnostics` 数组（均为 `severity: warning`）：

| code | 含义 |
|------|------|
| `scan-root-not-found` | 扫描根不存在或不可读，返回空路由表 |
| `scan-root-is-file` | 扫描根是文件；路由扫描从文件夹开始，请改用所在文件夹路由 |
| `scan-root-unsupported` | 扫描根既非目录也非 Markdown 文件 |
| `route-path-escaped` | `routePath` 逃出扫描根，拒绝扫描 |
| `unreadable-directory` | 某目录读不出来，跳过 |
| `unreadable-file` | 某 Markdown 文件读不出来，描述置空 |

## 开发循环（无需重启 dsh）

业务逻辑（扫描 / 投影 / 描述提取）都是普通函数，改完直接构建 + 跑 fixture 测试即可，
不用重启 dsh；只有改了 `index.ts` 的注册形状 / `inject` / `cordis.patch.yml` /
插件名才需要 profile boot。

从 extras 包根运行（模块没有嵌套 package.json——脚本在包根）：

```bash
pnpm run check-types:routes  # tsc --noEmit -p modules/routes/tsconfig.json
pnpm run build:routes        # tsc -p modules/routes/tsconfig.json  (src/ -> lib/)
pnpm run test:routes         # node --test --test-isolation=none  (test/*.test.mjs)
```

`test/*.test.mjs` 用 `node:test` 跑临时 fixture（无框架、无网络），构建后可独立运行。
`--test-isolation=none` 让测试保持 in-process——dsh 文件沙箱内以管道 stdio 派生
子进程会被阻断，进程内执行是必要条件。

若 PATH 上没有 `tsc`，用宿主提供的 tsc，见[包根 README 开发节](../README.md)。
