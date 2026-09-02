import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { check as checkPublishReadiness } from '../../../scripts/verify-publish-readiness.mjs'

const packageRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..') // extras package root

test('publish-readiness gate passes for the current package', () => {
  assert.deepEqual(checkPublishReadiness(packageRoot), [])
})

test('publish-readiness gate catches non-registry dependencies and escaping doc links', () => {
  const violations = checkPublishReadiness(packageRoot, {
    manifestOverride: {
      private: true,
      dependencies: { yaml: 'link:../../deepseek-harness/node_modules/.pnpm/yaml@2.9.0/node_modules/yaml', '@deepseek-ai/cordis': '*' },
      scripts: {
        build: '..\\..\\deepseek-harness\\node_modules\\.bin\\tsc.cmd -p .',
        eval: 'node ../eval/bin/dsh-eval.mjs --repo ../../deepseek-harness --fixture ../md-links/test',
      },
      devDependencies: {
        '@catheadowl/dsh-eval': 'file:../eval',
        'left-pad': 'file:../left-pad',
      },
    },
    extraMarkdown: [
      { path: 'docs/escape.md', text: '[spec](../../../workunits/gates/spec/gate-fixer.md) and [abs](/deepseek-harness/docs) plus plain-text `../../../workunits/gates/TODO/x.md`' },
      { path: 'docs/inside.md', text: 'see `../README.md` (exists in-package) — must not be flagged' },
    ],
    extraScripts: [
      { path: 'scripts/escape.mjs', text: "import { x } from '../../handbooks/dsh-plugin-dev/scripts/verify-package-face.mjs'\nconst ts = new URL('../../../deepseek-harness/node_modules/typescript/lib/typescript.js', import.meta.url)\nimport yaml from 'yaml'" },
    ],
    extraSources: [
      { path: 'modules/x/src/leak.ts', text: '// see ADR 0008 / spec「归一化规则」; tracked in TODO 20260831-posthoc\nexport const x = 1\n// spawn spec (ordinary noun) and const spec: AtRunSpec stay legal\n' },
    ],
  })
  const reasons = violations.map(violation => violation.reason).join('\n')
  assert.match(reasons, /"private": true/u)
  assert.match(reasons, /dependencies must not contain host package @deepseek-ai\/cordis/u)
  assert.match(reasons, /dependencies\.yaml uses non-registry specifier/u)
  assert.match(reasons, /links outside the package root/u)
  assert.match(reasons, /links absolute repo path/u)
  assert.match(reasons, /docs\/escape\.md cites dev-repo path \.\.\/\.\.\/\.\.\/workunits\/gates\/TODO\/x\.md which does not resolve to an existing in-package path/u)
  // In-package relative tokens that exist must NOT be flagged.
  assert.doesNotMatch(reasons, /docs\/inside\.md cites dev-repo path/u)
  assert.match(reasons, /scripts\/escape\.mjs references \.\.\/\.\.\/handbooks/u)
  assert.match(reasons, /scripts\/escape\.mjs references \.\.\/\.\.\/\.\.\/deepseek-harness/u)
  assert.match(reasons, /scripts\.eval references \.\.\/eval\/bin\/dsh-eval\.mjs/u)
  assert.match(reasons, /scripts\.eval references \.\.\/md-links\/test/u)
  // Own-scope dev-time devDeps (file:/git:) are exempt; foreign ones are not.
  assert.doesNotMatch(reasons, /devDependencies\.@catheadowl\/dsh-eval/u)
  assert.match(reasons, /devDependencies\.left-pad uses non-registry specifier/u)
  assert.match(reasons, /modules\/x\/src\/leak\.ts cites control-plane term/u)
  // L0 host borrows must NOT be flagged (documented exception).
  assert.doesNotMatch(reasons, /scripts\.build references/u)
  // Ordinary-noun / identifier uses of "spec" must not be flagged.
  assert.equal((reasons.match(/control-plane term/gu) ?? []).length, 3)
})
