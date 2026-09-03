export default {
  profile: 'headless',
  // 宿主 CLI 不再用 repo 键直指检出（host-checkout-resolution spec 退役契约）：
  // 解析链为 --repo flag > node_modules/@deepseek-ai/dsh 解析层 > 本键（已删）。
  // 解析层由 relink-dsh-peers（DSH_REPO 锚点）构建。
  // eval 临时工作区非 git 仓库，doc-link gate 会以 git 报错成 blocking 并
  // splice 反馈步骤耗尽脚本——测插件工具面的 case 默认禁 gates 行；gates
  // 模块自己的 gate 交互 case（attribution-filter）在 case 级声明
  // disableRows: [] 显式恢复装载。
  disableRows: ['gates'],
}
