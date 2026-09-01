---
description: gates 插件维护指南——消费面变更、构建与测试阶梯、自举 gates、兼容纪律与发布前验收
---

# gates development guide

## 消费面变更

修改 `package.json` exports、root entry、`src/register.ts`、`gates_run` schema 或 client 入口时，先更新 [register.md](register.md) 与对应测试，再重建产物。root entry 只保留 `name`、`inject`、`Config`、`apply`；新增公共类型必须从 `src/register.ts` 导出并由 generated reference 覆盖。

依据：宿主 package 入口与 NodeNext consumer 校验见开发仓库 `deepseek-harness/docs/development.md`；插件消费面规则见开发仓库 `handbooks/dsh-plugin-dev/11-plugin-consumer-face.md`。

## 构建与测试

```powershell
Set-Location d:\Document\Projects\dsh\dsh-plugin-dev\extras\modules\gates
..\..\..\..\deepseek-harness\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json
..\..\..\..\deepseek-harness\node_modules\.bin\tsc.cmd -p tsconfig.json
..\..\..\..\deepseek-harness\node_modules\.bin\tsdown.cmd
# 单测清单以 package.json 的 test script 为准（SSOT），此处不复述
node --test --test-isolation=none <package.json test 列出的文件>
node scripts/register-reference.mjs --write
```

组合测试需要本机 host junction 与已构建的 extras md 模块：

```powershell
node --test --test-isolation=none test/composition.test.mjs
```

不要在本目录运行 `pnpm install`；依赖解析与宿主检出约定见 [../README](../README.md)。

## 自举 gates

本项目的 `gates.yml` 声明四个 module gates：

- `register-face-boundary`：package/root/register 导出与禁止 import 模式；
- `register-docs-fresh`：[register.md](register.md) 的 generated API region；
- `docs-nav`：docs 导航与 package README 入口；
- `publish-readiness`：独立发布卫生（peer-only 宿主依赖、registry 版本范围、docs 与 scripts 不越出包根）。

在 gates 目录打开 dsh 会话后，用 `/gates` 或 `gates_run` 执行。脚本源码在 `scripts/`；它们是项目自举资产，不进入发布包运行时。

## 兼容与发布

- `./register` 是已承诺消费面；开发期也不随意重命名。
- gate 契约类型变更必须同步 generated reference、quickstart 与消费者测试。
- `gates_run` 是模型可见公共面；schema、输出与描述按 agent tool 契约维护。
- root implementation exports 已移除，不添加兼容 alias。

依据：宿主模型工具契约见开发仓库 `deepseek-harness/docs/cookbook/adding-a-tool.md`；测试选择见开发仓库 `handbooks/dsh-plugin-dev/12-plugin-consumer-face-test-sop.md`。
