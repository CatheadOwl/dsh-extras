export default {
  profile: 'headless',
  repo: '../../deepseek-harness',
  // eval 临时工作区非 git 仓库，doc-link gate 会以 git 报错成 blocking 并
  // splice 反馈步骤耗尽脚本——测插件工具面的 case 默认禁 gates 行；gates
  // 模块自己的 gate 交互 case（attribution-filter）在 case 级声明
  // disableRows: [] 显式恢复装载。
  disableRows: ['gates'],
}
