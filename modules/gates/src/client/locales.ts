export type GatesLocaleKey =
  | 'tab'
  | 'title'
  | 'description'
  | 'loading'
  | 'empty'
  | 'error'
  | 'retry'
  | 'refresh'
  | 'levelBlocking'
  | 'levelAdvisory'
  | 'levelDefer'
  | 'triggerStop'
  | 'triggerManual'
  | 'sourcePlugin'
  | 'sourceProject'

export const en: Record<GatesLocaleKey, string> = {
  tab: 'Gates',
  title: 'Quality gates',
  description: 'All gates run together through two fixed run points: the `gates_run` tool (agent-invoked; one call runs every manual-enabled gate) and the turn-end hook (automatic; runs every turn-stop-enabled gate when the turn closes). The switches only decide whether a gate takes part in a run point — turning a dimension off just removes that gate from that run. One tool runs all gates; there is no per-gate tool.',
  loading: 'Loading gates…',
  empty: 'No gates are registered for this workspace.',
  error: 'Failed to load gates.',
  retry: 'Retry',
  refresh: 'Refresh',
  levelBlocking: 'blocking',
  levelAdvisory: 'advisory',
  levelDefer: 'defer',
  triggerStop: 'turn-stop',
  triggerManual: 'manual',
  sourcePlugin: 'plugin',
  sourceProject: 'repo config',
}

export const zh: Record<GatesLocaleKey, string> = {
  tab: 'Gates',
  title: '质量门禁',
  description: '所有门禁经两个固定承载点批量运行：`gates_run` 工具（agent 调用，一次运行全部手动维开启的门禁）与轮末钩子（自动，轮次关闭时运行全部轮末维开启的门禁）。开关只决定某门禁是否参与对应承载点——关掉某一维只是把该门禁移出那次运行。工具只有一个（`gates_run`），并非每个门禁一个工具。',
  loading: '正在加载门禁…',
  empty: '当前工作区没有注册门禁。',
  error: '加载门禁失败。',
  retry: '重试',
  refresh: '刷新',
  levelBlocking: '阻断',
  levelAdvisory: '建议',
  levelDefer: '旁路',
  triggerStop: '轮末',
  triggerManual: '手动',
  sourcePlugin: '插件',
  sourceProject: '仓库配置',
}
