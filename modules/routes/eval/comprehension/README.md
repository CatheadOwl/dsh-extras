# any_routes comprehension review

这是 [`../README.md`](../README.md) 所述的理解设计评审。`fixtures.json` 保存稳定的 Markdown KB 输入与导航 hops；`any-routes.review.mjs` 用当前 `lib/routes.js` 实时生成 flat/tree 输出，并把临时路径标准化后填入 `prompt.md`。reviewer 看不到 `rubric.md`。

运行与产物约定见 [`../README.md`](../README.md)。人工评分重点是字段含义、逐 hop 的 `routePath` 决策，以及 reviewer 新发现的歧义是否超出 rubric 中已经接受的 intentional design。
