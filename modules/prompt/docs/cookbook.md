---
description: touch lane 使用指南——tool-touch 信号源的三种消费角色、配对 provider 的完整模式（稳态 resolve、自编辑对账、镜像对齐）与语义速查
---

# touch lane 使用指南

面向要消费（或只是想知道会不会被影响）`tools/result` 文件 touch 信号的插件作者。契约权威在 [contract.md](contract.md)「tool-touch sensor lane」节；本文只讲**怎么用对**。

## 先判定你的角色

| 角色 | 声明 | 效果 |
|---|---|---|
| **不关心 touch** | 什么都不写（不声明 `sources` / `touchSubjects`） | 行为与本特性引入前完全一致；同 turn 里别的 provider 触发的 sensor 流量对你零感知 |
| **只要失效** | 只声明 `touchSubjects`（不声明 `sources`） | 文件被 read/edit 后，你已注入的 subject 的 once 账被摘——下次提及时重新 resolve（内容可能已变）。不接收任何 touch 注入输入 |
| **消费 touch 注入** | 声明 `sources: ['prompt', 'touch']` + `touchSubjects` | 失效之外，下一步还会把 touch 投影出的 subject 作为伪路径喂给你的 `resolve` |

框架统一持有 `tools/result` 监听——**永远不要自己挂 `tools/result` 做注入**，那会绕开 once 账本 / 预算 / 渲染纪律，正是这套框架要替所有注入者共管的东西。

## 心智模型：touch 是通知，resolve 是拉取

一次 `read`/`edit` 只做两件事：摘账（内容可能变了，作废旧注入）+ 把路径记入 pending；**内容重读发生在下一步 pre-step 的 `resolve` 里**。所以你的 `resolve` 会被同一路径反复调用——它的返回值就是唯一的「要不要说话」开关。

## 完整模式：配对型 provider

典型场景：你的插件对某些文件持有配对知识（注释、状态、链接），希望 agent 每次 touch 这些文件时看到最新的一条，但不要唠叨。

```ts
import { registerRelatesProvider } from '@catheadowl/dsh-extras/prompt/register'

registerRelatesProvider(ctx, {
  name: 'my-pairing',
  kind: 'my-pair-note',
  sources: ['prompt', 'touch'],
  // 同步计算、无隐藏输入：touched + 会话上下文 → 它关联的 subject（无关联返回 []）。
  // context.cwd 就是 sensor 归一这条路径所用的 session cwd——subject 空间按项目
  // （per-cwd 配置）变化的声明方在这里查表选投影目标；查表应同步、缓存化。
  touchSubjects: (touched, context) =>
    isPaired(touched, context.cwd) ? [pairedSubjectOf(touched, context.cwd)] : [],
  async resolve({ path }) {
    const state = await loadPairState(path.path)
    if (state === undefined) return undefined

    // 纪律一（稳态沉默）：这个 subject 本 session 已渲染过且状态没变 → 什么都不说
    if (rendered.has(path.path) && state.version === rendered.get(path.path)) return undefined
    rendered.set(path.path, state.version)

    // 纪律二（自编辑对账）：agent 自己刚改的文件不回叙，只刷记录
    if (path.origin === 'touch' && path.touchTool === 'edit') {
      return undefined          // 记录已在上面刷新；复述 agent 刚做的事是噪音
    }

    return { value: formatPairNote(state, path.path) }
  },
})
```

（`rendered` 是 provider 闭包自持的 `Map<path, version>`——框架不感知「状态」，渲染策略整体住你这边。）

### 四条 provider 侧纪律

1. **稳态返回 `undefined`**：touch 每次都会重新 offer 同一 subject；「没新东西可说」必须显式沉默。稳态成本 = 每次 touch 一次查询、零注入；状态每翻转一次恰好多注一条——这正是想要的节奏。
2. **自编辑不回叙**：`path.origin === 'touch' && path.touchTool === 'edit'` 是 agent 自己的动作，复述即噪音；只刷新你的内部记录（对账）。
3. **两个投影要镜像对齐**：`subjectOf`（提及 → key）与 `touchSubjects`（touch → subject）若指向不同 subject 空间，跨源去重会失效（prompt 注入过、touch 又注一次）。配对型 provider 通常两者恒等或互为正反映射。
4. **`resolve` 幂等廉价**：它会被反复调用（每 touch 一次），不要在里面做重活或累积副作用。

## 语义速查

| 问题 | 答案 |
|---|---|
| once key 是什么 | touch 伪路径的 subject **本身**（`subjectOf` 不会对它二次投影）；prompt 侧仍是 `subjectOf` 投影 |
| 谁触发摘账 | 声明了 `touchSubjects` 的所有 provider——**无论是否订阅 touch、无论是否被开关关掉**（开关是纯执行过滤，不屏蔽失效） |
| 被 turn 打断的 touch 呢 | turn 边界丢弃，不跨 turn 追注（模型刚被打断、会话已重定向） |
| 关掉的 provider | 不执行、不记账；其 `touchSubjects` 声明仍参与摘账；re-enable 后被摘过的 key 经下次提及/touch 重跑 |
| `resolve` 抛错 | 你的 provider 记一条 `failed` trace，不影响其他 provider、不打断轮次 |
| 路径是什么形态 | 项目相对、`/` 分隔（touch 按会话 cwd 归一；项目外路径保留绝对形，配不上的自然忽略） |
| `touchSubjects` 的第二参 | `{ cwd, sessionId? }`：cwd 在摘账点 = sensor 归一该 touch 的 session cwd，在消费投影点 = 当前 pre-step 的 cwd。subject 空间按项目（per-cwd 配置）变化的声明方在这里查表选投影目标——同一路径在两个 cwd 下可以落到不同 subject |

## 常见坑

- **`write` 不在闭集**：新建文件的 touch 信号暂不产生（空白语义未定）；新建配对文档的场景目前只能靠 prompt 提及。
- **声明了 `'touch'` 却忘写 `touchSubjects`**：注册期直接抛错（死订阅）。
- **想「touch 时立即注入」**：没有这个时机——注入永远发生在下一步 pre-step（模型可见时机相同，且免掉异步投影的串行化成本）。
- **混合批的 trace**：一批输入同时含 prompt 路径与 touch 伪路径时，trace 记 `source: 'touch'`（新信号优先观测）；纯观测字段，不影响执行。
