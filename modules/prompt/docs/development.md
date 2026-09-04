---
description: prompt 模块维护指南——本机命令、组合测试前置与宿主 junction 接线
---

# prompt development guide

## 本机命令（extras 包根 scripts）

```powershell
# 从 extras 包根
pnpm run check-types:prompt
pnpm run build:prompt
pnpm run test:prompt    # 库(parse/tree) + 框架 + wire + client-storage
# 组合测试：真实 agent-loop + mock adapter，验证 `once` 去重 + surface replace（compact）清账
# 不在 verify 内：依赖 host 源码 junction（接线方式见包根 README 开发节），新克隆 / 非本机不可跑
cd modules\prompt ; node --test --test-isolation=none test/composition.test.mjs
```

依赖解析与宿主检出约定见 [../README](../README.md)。
