---
description: prompt 的可运行参考实现目录——冻结标本（不随活代码演进），首件为配对型 touch provider（自编辑对账 + 推迟不吞掉的正确写法）；文档面在 docs/cookbook.md，本目录只放能被消费者直接复制的代码
---

# examples/

prompt 的**可运行参考实现**：完整、可复制的 provider 声明标本，作为 [docs/cookbook.md](../docs/cookbook.md)「完整模式：配对型 provider」与「原子设计：自编辑是推迟，不是吞掉」的配套代码。散文文档在 [`docs/`](../docs/README.md)，本目录只放代码。

## 冻结声明

本目录的文件是**冻结标本**：展示某个消费形态的完整写法，不随活代码演进。活的面在模块 `src/`（框架机制在那里演进）；这里的分叉是 by-design，不回灌。防 bitrot：`test/examples.test.mjs` 会把标本注册到真实 runner 上跑冒烟 case——特别是「对账不推进已见记录」的顺序，改错一步断言就红。

## 首件：paired-note（配对型 touch provider）

[paired-note/provider.mjs](paired-note/provider.mjs)——对一组受配文件持有派生注记的参考实现：`sources: ['prompt', 'touch']` + 双向配对投影 + **正确顺序的 resolve**（自编辑对账在前、不推进已见记录；记录只在真正渲染时推进）。依赖全部经工厂参数注入，零框架外 import，消费者照抄后替换 `loadPairState` 等四个函数即可。

冒烟断言的三段（对应 cookbook 原子设计节）：

1. prompt 提及 → 注入 v1；
2. 自编辑（状态随之翻到 v2）→ edit touch 重提 → **沉默**（对账，不渲染不记账不推进记录）；
3. 下一次有机 read → **v2 注入浮出**（已见记录仍停在 v1，差兑现）——若标本把对账写成「先推进记录再沉默」，第 3 步断言翻红：信号被吞掉的形态。
