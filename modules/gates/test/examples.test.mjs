// Frozen-specimen smoke tests: every file under examples/ must stay loadable
// and keep the generic gate surface (`check(root, changes?)` returning
// violations). These do NOT track the live data planes — divergence between a
// specimen and its module source is by-design; this suite only guards bitrot.
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { check } from '../examples/md-metadata/module-form.mjs'

const roots = []

function fixture(files) {
  const root = join(tmpdir(), `dsh-gates-examples-${process.pid}-${roots.length}`)
  roots.push(root)
  for (const [path, source] of Object.entries(files)) {
    const abs = join(root, path)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, source)
  }
  return root
}

test('md-metadata specimen: passes a described file, flags a bare one', () => {
  const root = fixture({
    'ok.md': '---\ndescription: a summary\n---\n# A\n',
    'bad.md': '# No frontmatter\n',
  })
  const changes = { paths: ['ok.md', 'bad.md'], opaque: false }
  const violations = check(root, changes)
  assert.equal(violations.length, 1)
  assert.equal(violations[0].file, 'bad.md')
  assert.match(violations[0].reason, /missing YAML frontmatter/)
  assert.equal(violations[0].remedy.kind, 'manual')
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

test('md-metadata specimen: null change set (manual entry) stays a no-op', () => {
  const root = fixture({ 'a.md': '# No frontmatter\n' })
  assert.deepEqual(check(root, undefined), [])
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})
