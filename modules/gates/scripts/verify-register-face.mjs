import { join, resolve } from 'node:path'

import { loadTypeScript } from './lib/resolve-typescript.mjs'
import { verifyPackageFace } from './lib/package-face.mjs'

export async function check(root) {
  const ts = await loadTypeScript()
  const violations = await verifyPackageFace({
    package: join(resolve(root, '../..'), 'package.json'),
    rootExport: null,
    rootEntry: join(root, 'src/index.ts'),
    rootExports: ['name', 'inject', 'Config', 'apply'],
    subentries: {
      './register': join(root, 'src/register.ts'),
      './client': join(root, 'src/client/index.ts'),
    },
    facadeExports: {
      './register': [
        'registerGate',
        'GateChangeSet',
        'GateDefinition',
        'GateFixer',
        'GateFixerCommand',
        'GateFixerSubagent',
        'GateFixerSubagentRequest',
        'GateLevel',
        'GateRemedy',
        'GateRemedyManual',
        'GateRemedyOperation',
        'GateResult',
        'GateStatus',
        'GateTrigger',
        'GateViolation',
      ],
    },
    forbiddenImports: [
      /from\s+['"]@catheadowl\/dsh-extras(?!\/register(?:\.js)?['"])[^'"]*['"]/u,
    ],
    scanPaths: [join(root, 'src'), join(root, 'docs')],
    ts,
  })
  return violations.map(reason => ({
    reason,
    remedy: {
      kind: 'manual',
      guidance: 'Keep the dsh loader contract on the root entry and expose plugin-consumer symbols only through @catheadowl/dsh-extras/register.',
    },
  }))
}
