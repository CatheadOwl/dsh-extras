// register face 的 generated API reference:check(root) 供 gates.yml /
// node:test 消费;--write 时原地重生成 docs/register.md 的 generated region。
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'

import { loadTypeScript } from './lib/resolve-typescript.mjs'
import { generateApiReference } from './lib/api-reference.mjs'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

export async function check(packageRoot = root, ts) {
  const compiler = ts ?? await loadTypeScript()
  const { changed } = await generateApiReference({
    source: join(packageRoot, 'src/register.ts'),
    output: join(packageRoot, 'docs/register.md'),
    packageRoot,
    check: true,
  }, compiler)
  return changed
    ? [{
        reason: 'generated API reference is stale: docs/register.md',
        remedy: {
          kind: 'manual',
          guidance: 'Run node scripts/register-reference.mjs --write from the gates package, then review the public contract change.',
        },
      }]
    : []
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('register-reference.mjs')) {
  if (process.argv.includes('--write')) {
    loadTypeScript().then(ts => generateApiReference({
      source: join(root, 'src/register.ts'),
      output: join(root, 'docs/register.md'),
      packageRoot: root,
    }, ts)).then(({ changed }) => {
      if (changed) console.log('updated docs/register.md generated API reference')
    }, (error) => {
      console.error(error.message)
      process.exitCode = 2
    })
  }
  else {
    check().then((violations) => {
      for (const violation of violations) console.error(violation.reason)
      process.exitCode = violations.length === 0 ? 0 : 1
    }, (error) => {
      console.error(error.message)
      process.exitCode = 2
    })
  }
}
