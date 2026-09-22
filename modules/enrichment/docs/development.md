---
description: enrichment 模块维护指南——本机命令、组合测试前置与宿主 junction 接线
---

# prompt development guide

## 本机命令（extras 包根 scripts）

```powershell
# 从 extras 包根
pnpm run check-types:enrichment
pnpm run build:enrichment
pnpm run test:enrichment    # 库(parse/tree) + 框架 + wire + client-storage + 组合测试（见下）
```

## 组合测试（host 接线条件运行）

两套组合测试已挂在 `test:enrichment` 末尾，经包根 `scripts/run-composition.mjs`（不随包发布，名称引用）条件运行：

- **能跑的形态**：真实 agent-loop + mock adapter，验证 `once` 去重 + surface replace（compact）清账；touch 套件脚本化模型真实调用 read/edit（defineContentToolFixture），端到端驱动 sensor → pending → pre-step 消费——v0 等价、chatter 稳态、状态翻转重注、无配对、开关 × touch。
- **前置**：host 源码 junction + 宿主检出已 build（接线方式见 [../../../docs/development.md](../../../docs/development.md) 的「宿主 checkout 锚点」节——`relink-host-peers.mjs` junction 接线）。
- **三态**：探测 `@deepseek-ai/dsh-agent-loop` 可解析且导出目标在盘 → 真实运行；本 checkout 无接线（新克隆 / 独立镜像形态）→ 输出一行 SKIPPED 后跳过；接线在场但不可运行（junction 失效 / 宿主未 build）→ **失败不跳过**。

单独直跑（不经 runner）：

```powershell
cd modules\prompt ; node --test --test-isolation=none test/composition.test.mjs
cd modules\prompt ; node --test --test-isolation=none test/touch-composition.test.mjs
```

依赖解析与宿主检出约定见 [../README](../README.md)。
