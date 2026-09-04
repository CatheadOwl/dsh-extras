/**
 * Deterministic documentation tree for the relates A/B experiment, v2
 * (workunits/prompt-middleware/probe/20260905-relates-behavior-ab.md).
 *
 * v2 design targets the owner's two scenarios directly:
 *
 * - orientation: the mention resolves, but the answer doc must be picked
 *   among grep-level distractors — the breadcrumb description names it;
 * - triage: a deprecated/current twin pair is mentioned together, and the
 *   disposition (现行 vs 已废弃) lives ONLY in the directory README
 *   descriptions, never in file bodies — grep cannot distinguish them.
 *
 * Invariants: the marker sentence lives in exactly ONE file (the current
 * twin); the deprecated twin carries a plausible DIFFERENT rule so quoting
 * it is a clean failure; the word 发送窗口 appears in several files so a
 * bare grep hits multiple results.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The sentence whose presence in the final answer marks success (current twin only). */
export const MARKER = '发送窗口默认 30 秒，超时静默丢弃，不重试。'

/** The workspace-relative path of the locate target (current twin). */
export const TARGET_PATH = 'services/notify/templates.md'

/** Paths a well-oriented agent should never need to read. */
export const AVOID_PATHS = ['services/notify-legacy/templates.md']

const FILES = {
  'README.md': `---
description: 内部服务仓库——通知与导出两个服务的实现与规范
---

# 内部服务仓库

服务实现都在 services/ 下。
`,

  'services/README.md': `---
description: 服务层路由——notify（现行）、notify-legacy（已废弃，2024-06 冻结）、export（现行）三个服务的入口
---

# 服务

- notify/：通知服务（现行）
- notify-legacy/：通知服务旧版（已废弃，仅存档）
- export/：导出服务（现行）
`,

  'services/notify/README.md': `---
description: 通知服务（现行）——发送窗口与模板规则在 templates.md，渠道配置在 channels.md
---

# 通知服务（现行）

- templates.md：发送窗口与模板规则
- channels.md：渠道与限速配置
`,

  [TARGET_PATH]: `---
description: 通知服务模板与发送窗口规则（现行）
---

# 模板与发送窗口

发送窗口默认 30 秒，超时静默丢弃，不重试。模板变量只允许白名单内的字段。
`,

  'services/notify/channels.md': `---
description: 通知渠道与限速配置
---

# 渠道与限速

各渠道限速独立计算，与发送窗口（规则见 templates.md）交互时以较严者为准。
`,

  'services/notify-legacy/README.md': `---
description: 通知服务旧版（已废弃，2024-06 冻结）——旧模板布局与旧发送窗口规则，仅存档，勿在此修改
---

# 通知服务旧版（已废弃）

2024-06 起冻结，现行实现见 ../notify/。旧模板规则保留仅作迁移参考。
`,

  'services/notify-legacy/templates.md': `---
description: 旧版模板与发送窗口规则（已废弃）
---

# 旧版模板与发送窗口

发送窗口默认 10 秒，超时重试一次。模板变量沿用旧白名单。
`,

  'services/export/README.md': `---
description: 导出服务（现行）——流水线在 pipeline.md，格式清单在 formats.md
---

# 导出服务（现行）

- pipeline.md：导出流水线
- formats.md：支持的格式
`,

  'services/export/pipeline.md': `---
description: 导出流水线——分批、校验与投递
---

# 导出流水线

导出按批处理窗口分批，校验后投递。批处理窗口与通知服务无关。
`,

  'services/export/formats.md': `---
description: 导出格式清单——CSV 与 JSON
---

# 格式清单

当前支持 CSV 与 JSON 两种导出格式。
`,
}

/** Seed the documentation tree into the eval workspace. */
export function seedDocTree(workspace) {
  for (const [relative, content] of Object.entries(FILES)) {
    const target = join(workspace, relative)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, content, 'utf8')
  }
}
