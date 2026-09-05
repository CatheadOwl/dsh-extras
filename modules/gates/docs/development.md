---
description: gates 插件维护指南——消费面变更、构建与测试阶梯、自举 gates、兼容纪律与发布前验收
---

# gates development guide

## 消费面变更

修改 `package.json` exports、root entry、`src/register.ts`、`gates_run` schema 或 client 入口时，先更新 [register.md](register.md) 与对应测试，再重建产物。root entry 只保留 `name`、`inject`、`Config`、`apply`；新增公共类型必须从 `src/register.ts` 导出并由 generated reference 覆盖。

依据：宿主 package 入口与 NodeNext consumer 校验见开发仓库 `deepseek-harness/docs/development.md`；插件消费面规则见外部开发笔记（plugin-consumer-face，名称引用）。

## 构建与测试

```powershell
Set-Location <extras-checkout>\modules\gates
# 直调，不走 pnpm run（pnpm 在此目录会触发依赖状态校验）；tsc/tsdown 借用 dsh 宿主检出的工具链
<host-checkout>\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json
<host-checkout>\node_modules\.bin\tsc.cmd -p tsconfig.json
<host-checkout>\node_modules\.bin\tsdown.cmd   # Web 配置页 client bundle → lib/client.js
# 单测清单以 extras 包根 package.json 的 scripts.test:gates 为准（SSOT），此处不复述
node --test --test-isolation=none <package.json test 列出的文件>
node scripts/register-reference.mjs --write
```

组合测试（真实 agent-loop + mock adapter，验证 turn-stopping 驱动：defer 旁路 / blocking 续步）需要本机 host junction 与已构建的 extras markdown 模块（有用例 import 其 `lib/gate-check.js` 构建产物）；不在 `pnpm verify` 内，新克隆 / 非本机不可跑：

```powershell
node --test --test-isolation=none test/composition.test.mjs
```

不要在本目录运行 `pnpm install`；依赖解析与宿主检出约定见 [../README](../README.md)。

## 宿主 junction 接线

junction 解析层：**extras 包根 `node_modules/`**（全模块共享一份）的 `@deepseek-ai/{cordis,schemastery,dsh-tools,dsh-llm,dsh-agent,dsh-session, dsh-typert-protocol,dsh-invariants}` 指向 dsh 宿主检出（vendored 源码的 `lib/types`/包目录，接线配方见包根 README 开发节；`dsh-commands`、`dsh-skill`、`dsh-subagent` 仅类型面，走 `import type {}`，插件 lib 运行时不需要 junction）。组合测试（`test/composition.test.mjs`）额外需要 `dsh-system-prompt`、`dsh-agent-loop`、`dsh-subagent`、`dsh-subagent-fork-in-process` 四个 junction，同样指向 host 包目录。Web 配置页（client half）的类型依赖走 tsconfig `paths` 指向 host 包 `lib/types`；`react` / `@types/react` 以 junction 指向 vendored `.pnpm` 的版本化路径。

校验脚本用的 TypeScript 走同一约定：包根 `node_modules/typescript` junction 指向宿主安装。脚本代码里**零宿主路径字面量**（包级 `scripts/lib/resolve-typescript.mjs` 只认本地可解析的 `typescript` 与 `DSH_TYPESCRIPT_PATH` 覆盖），越出包根的 import / `new URL(...)` 路径会被 `publish-readiness` gate 拦截。

## 自举 gates

自举 gates 声明在**包根** [`gates.yml`](../../../gates.yml)（2026-09-06 自各模块 gates.yml 整合而来；入口脚本按自身位置锚定，与加载它的会话根无关），共四个 module gates：

- `register-face-boundary`：package/root/register 导出与禁止 import 模式；
- `register-docs-fresh`：[register.md](register.md) 的 generated API region（入口在 `modules/gates/scripts/`）；
- `docs-nav`：全部 docs-owning 模块（gates / markdown / prompt）的导航与 README 入口（包级遍历入口在 `scripts/verify-docs-nav.mjs`）；
- `publish-readiness`：独立发布卫生（peer-only 宿主依赖、registry 版本范围、docs 与 scripts 不越出包根）。

在 **extras 包根**打开 dsh 会话后，用 `/gates` 或 `gates_run` 执行。脚本源码在包根 `scripts/` 与 `modules/gates/scripts/`；它们是项目自举资产，不进入发布包运行时。

## 兼容与发布

- `./gates/register` 是已承诺消费面；开发期也不随意重命名。
- gate 契约类型变更必须同步 generated reference、quickstart 与消费者测试。
- `gates_run` 是模型可见公共面；schema、输出与描述按 agent tool 契约维护。
- root implementation exports 已移除，不添加兼容 alias。

依据：宿主模型工具契约见开发仓库 `deepseek-harness/docs/cookbook/adding-a-tool.md`；测试选择见外部开发笔记（plugin-consumer-face-test-sop，名称引用）。
