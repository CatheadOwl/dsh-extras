import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { enumerateWorkspacePaths } from '../lib/tree/index.js'

// `files` maps a project-relative path to its content; a trailing `/` means
// "directory" (content ignored).
async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'ws-tree-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    if (rel.endsWith('/')) {
      await mkdir(abs, { recursive: true })
    } else {
      await mkdir(join(abs, '..'), { recursive: true })
      await writeFile(abs, content ?? '')
    }
  }
  return root
}

test('enumerates files and directories; directories carry a trailing slash', async () => {
  const root = await fixture({ 'a.txt': '', 'sub/': '', 'sub/b.txt': '' })
  try {
    assert.deepEqual(await enumerateWorkspacePaths(root), ['a.txt', 'sub/', 'sub/b.txt'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('applies root .gitignore: glob, dir-only, and anchored patterns', async () => {
  const root = await fixture({
    '.gitignore': '*.log\nnode_modules/\n/build\n/rooted.txt\n',
    'keep.txt': '',
    'drop.log': '',
    'node_modules/pkg/readme.md': '',
    'build/out.js': '',
    'rooted.txt': '',
    'sub/rooted.txt': '',
  })
  try {
    const paths = await enumerateWorkspacePaths(root)
    assert.ok(!paths.some((p) => p.includes('node_modules')), 'node_modules/ pruned')
    assert.ok(!paths.some((p) => p.endsWith('.log')), '*.log pruned')
    assert.ok(!paths.some((p) => p === 'build/' || p.startsWith('build/')), '/build pruned')
    assert.ok(!paths.includes('rooted.txt'), 'anchored /rooted.txt pruned at root')
    assert.ok(paths.includes('sub/rooted.txt'), 'anchored pattern does not leak into sub/')
    assert.ok(paths.includes('keep.txt'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('nested .gitignore applies only below its own directory', async () => {
  const root = await fixture({
    '.gitignore': '',
    'sub/.gitignore': '*.tmp\n',
    'sub/a.tmp': '',
    'sub/b.txt': '',
    'x.tmp': '',
  })
  try {
    const paths = await enumerateWorkspacePaths(root)
    assert.ok(!paths.includes('sub/a.tmp'), 'nested *.tmp pruned')
    assert.ok(paths.includes('sub/b.txt'))
    assert.ok(paths.includes('x.tmp'), 'nested rule does not leak upward')
    assert.ok(paths.includes('sub/'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('always skips .git (metadata dir and submodule marker file)', async () => {
  const root = await fixture({
    '.git/config': '[core]\n',
    'sub/.git': 'gitdir: ../.git/modules/sub\n',
    'sub/c.txt': '',
  })
  try {
    const paths = await enumerateWorkspacePaths(root)
    assert.ok(!paths.some((p) => p.includes('.git')), '.git never emitted')
    assert.ok(paths.includes('sub/'), 'sub still walked (its .git is a file)')
    assert.ok(paths.includes('sub/c.txt'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
