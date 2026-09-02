import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import {
  applyRootRelativeNormalization,
  checkRepository,
  planRootRelativeNormalization,
} from '../lib/links/index.js'

const roots = []

function fixture(files) {
  const root = join(tmpdir(), `dsh-md-links-normalize-${process.pid}-${roots.length}`)
  roots.push(root)
  for (const [path, source] of Object.entries(files)) {
    const abs = join(root, path)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, source)
  }
  spawnSync('git', ['init', '-q', root], { stdio: 'ignore' })
  spawnSync('git', ['-C', root, 'add', '-A'], { stdio: 'ignore' })
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('planRootRelativeNormalization', () => {
  it('rewrites /-prefixed internal file links to document-relative', () => {
    const root = fixture({
      'README.md': '[guide](/docs/guide.md)\n',
      'docs/guide.md': '# Guide\n\n# Top\n\n[home](/README.md)\n',
      'docs/deep/note.md': '# Note\n\n[up](/docs/guide.md#top)\n',
    })
    const plan = planRootRelativeNormalization(root)
    assert.deepEqual(plan.skips, [])
    assert.deepEqual(plan.rewrites.map(r => r.href).sort(), ['../README.md', '../guide.md', 'docs/guide.md'])

    applyRootRelativeNormalization(plan)
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '[guide](docs/guide.md)\n')
    assert.equal(readFileSync(join(root, 'docs', 'guide.md'), 'utf8'), '# Guide\n\n# Top\n\n[home](../README.md)\n')
    assert.equal(readFileSync(join(root, 'docs', 'deep', 'note.md'), 'utf8'), '# Note\n\n[up](../guide.md#top)\n')
    assert.deepEqual(checkRepository(root), [])
  })

  it('rewrites a directory link and preserves the trailing slash', () => {
    const root = fixture({
      'README.md': '[docs](/docs/)\n',
      'docs/a.md': '# A\n',
    })
    const plan = planRootRelativeNormalization(root)
    assert.equal(plan.rewrites.length, 1)
    assert.equal(plan.rewrites[0].href, 'docs/')
    applyRootRelativeNormalization(plan)
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '[docs](docs/)\n')
  })

  it('rewrites image and definition references too', () => {
    const root = fixture({
      'README.md': '![logo](/assets/logo.png)\n\n[g]: /docs/guide.md\n',
      'assets/logo.png': 'png',
      'docs/guide.md': '# Guide\n',
    })
    const plan = planRootRelativeNormalization(root)
    assert.equal(plan.rewrites.length, 2)
    applyRootRelativeNormalization(plan)
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '![logo](assets/logo.png)\n\n[g]: docs/guide.md\n')
  })

  it('leaves protocol-relative, scheme, and site-root / links untouched', () => {
    const root = fixture({
      'README.md': '[x](/gates)\n[y](//cdn.example/a)\n[z](https://example.com)\n',
    })
    const plan = planRootRelativeNormalization(root)
    assert.equal(plan.rewrites.length, 0)
    assert.equal(plan.skips.length, 1) // only /gates is a /-prefixed candidate; // and https are not
    assert.match(plan.skips[0].reason, /not a tracked repository path/)
    applyRootRelativeNormalization(plan)
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '[x](/gates)\n[y](//cdn.example/a)\n[z](https://example.com)\n')
  })

  it('is idempotent: a second plan finds nothing left to rewrite', () => {
    const root = fixture({
      'README.md': '[a](/docs/a.md)\n',
      'docs/a.md': '# A\n',
    })
    applyRootRelativeNormalization(planRootRelativeNormalization(root))
    const again = planRootRelativeNormalization(root)
    assert.equal(again.rewrites.length, 0)
    assert.equal(again.skips.length, 0)
  })
})
