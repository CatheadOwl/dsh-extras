---
description: md-rename eval——headless behavior harness 覆盖 md_rename 工具内 fallback 阶梯（deterministic rebase / skip 非阻塞 / conflict 阻塞整单 / post-hoc repair）+ real 层意图路由 case；L2–L4 路 B gate 侧检测不在本目录
---

# md-rename eval

框架与规则以 `dsh-plugin-dev/eval/`（开发仓库 dsh-plugin-dev/eval/README.md，纯文本引用） 为准；本目录只放 md-rename 的 case。

## 覆盖范围（多层 fallback 的哪几层）

`md_rename` 是 spec §4 的 **L1 显式路径（权威）**。工具**内部**的 fallback 阶梯分三层，本目录逐层覆盖：

| 层 | 语义 | case |
|---|---|---|
| deterministic rebase | 入链改写 + 出链 rebase 均唯一可算 → `status: moved` | `rename-file` / `rename-directory` / `rename-pure-move` / `rename-preserve-fragment` |
| skip（非阻塞） | 断链出链 / external·`//`·`/`·scheme / 无 offset → 原样保留 + 报告，仍移动 | `rename-skip-broken-outlink` / `rename-skip-external` |
| conflict（阻塞整单） | `newPath` 已存在 / `oldPath` 缺失 / 仓库外 → 拒改，工作树零改动 | `rename-conflict-newpath-exists` / `rename-conflict-oldpath-missing` / `rename-conflict-outside-repo` |
| post-hoc repair（已实现） | rename 已发生且 git 佐证 → link-only，`status: repaired`；无佐证 → 拒绝 + remedy 三出口 | `rename-repaired` / `rename-conflict-no-evidence` |

**意图面（real 层）**：post-hoc 语义除 mock 管线外另有四个 real 意图 case 钉「自然语言 → 工具调用」的路由——显式修复对（任务给出已发生移动 → 必须译成同一 `md_rename` 对，而非移回/重建/手改链接）、发现式（只给旧路径，新位置靠探索推断，断言完整对）、无证据移动（未跟踪目录的移动：与修复 case 措辞相同，由 git 证据面分流为拒绝 + remedy）、缺失 oldPath 的 typo（委派给工具按普通冲突拒绝，不得凭空捏造源文件）。无证据与 typo case 的仓库故意不含指向旧路径的链接——turn-close 门禁与「最终态故意违规」eval case 的交互是另行登记的 workunit。

**out-of-scope**：L2（`--find-renames`）/ L3（内容相似度）/ L4（agent 报 possible-move）属**路 B gate 侧检测**，raw-requirements B4 明确「非工具 scope」且未实现——无此代码路径，本目录不覆盖。

## 目录

```text
eval/
  behavior/
    _fixtures/seed-repo.mjs   # 共享 fixture：seedRepo + pathExists + readText
    mock/                     # 脚本化模型 → 真实工具管线；确定性，免 key
    real/                     # 自然语言意图 → md_rename 选择与参数路由；需 key
      intent-rename.eval.mjs                  # 常规改名意图
      intent-rename-posthoc-repair.eval.mjs   # 显式「修复已发生的移动」
      intent-rename-posthoc-discovery.eval.mjs# 发现式：新位置靠探索推断
      intent-rename-no-evidence.eval.mjs      # 未跟踪移动：措辞同修复、证据面分流为拒绝
      intent-rename-oldpath-missing.eval.mjs  # typo：委派给工具按普通冲突拒绝
```

## 前置

所有 behavior case 都要求 **插件已装进被启动的 `headless` profile**：

```powershell
dsh plugin --profile headless add D:/Document/Projects/dsh/dsh-plugin-dev/extras
```

另需 `deepseek-harness` 的 CLI 已构建（`apps/cli/lib/bin.js`）。

## 运行

```powershell
# mock 层（免 key，确定性回归；工作目录：dsh-plugin-dev/extras/modules/md）
node ../eval/bin/dsh-eval.mjs run --profile headless --repo ../../deepseek-harness --mode mock eval/behavior/mock

# real 层（需 DEEPSEEK_API_KEY 或 $DSH_HOME/.credentials.yaml）
node ../eval/bin/dsh-eval.mjs run --profile headless --repo ../../deepseek-harness eval/behavior/real
```

失败产物落在 case 旁 `.runs/<case id>/`（gitignored，不提交）。
