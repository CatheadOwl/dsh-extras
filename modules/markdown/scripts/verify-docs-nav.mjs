import { join } from 'node:path'

import { verifyDocsNavigation } from '../../../scripts/lib/docs-navigation.mjs'

export function check(root) {
  return verifyDocsNavigation({
    entry: join(root, 'docs/README.md'),
    root: join(root, 'docs'),
    packageReadme: join(root, 'README.md'),
  }).map(reason => ({
    reason,
    remedy: {
      kind: 'manual',
      guidance: 'Link the document from docs/README.md and keep the package README linked to the documentation entry.',
    },
  }))
}
