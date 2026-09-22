import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolvePromptPathList } from '../lib/path-resolver.js'

test('resolvePromptPathList normalizes resolved file and directory paths', async () => {
  const paths = await resolvePromptPathList('docs/a.md docs/', '.', {
    candidatePaths: ['docs/', 'docs/a.md'],
  })
  assert.deepEqual(paths.map(path => [path.path, path.kind]), [
    ['docs/a.md', 'file'],
    ['docs', 'directory'],
  ])
  assert.ok(paths.every(path => path.mention.total === 1))
})

test('resolvePromptPathList expands a top-tier tie into multiple paths', async () => {
  const paths = await resolvePromptPathList('md-fabric', '.', {
    candidatePaths: ['dsh-plugin-dev/md-fabric/', 'workunits/md-fabric/'],
  })
  assert.deepEqual(paths.map(path => [path.path, path.kind]), [
    ['dsh-plugin-dev/md-fabric', 'directory'],
    ['workunits/md-fabric', 'directory'],
  ])
  assert.ok(paths.every(path => path.mention.total === 2))
  assert.ok(paths.every(path => path.mention.normalized === 'md-fabric'))
})

test('resolvePromptPathList keeps the first canonical path across mentions (dedupe + trace)', async () => {
  const trace = []
  const paths = await resolvePromptPathList('md-fabric dsh-plugin-dev/md-fabric/', '.', {
    candidatePaths: ['dsh-plugin-dev/md-fabric/', 'workunits/md-fabric/'],
    trace,
  })
  assert.deepEqual(paths.map(path => [path.path, path.kind]), [
    ['dsh-plugin-dev/md-fabric', 'directory'],
    ['workunits/md-fabric', 'directory'],
  ])
  assert.ok(trace.some(event =>
    event.provider === 'path-resolver'
    && event.status === 'skipped'
    && event.reason.includes('duplicate path'),
  ))
})

test('prose prompt with CJK-adjacent project names resolves embedded paths', async () => {
  // After CJK boundary tokenization, the English project name `subagent-at`
  // is split from surrounding Han prose and resolves as a bare token.
  // Previously this was a fused token (total=0 → empty path list).
  const trace = []
  const paths = await resolvePromptPathList(
    'explorer任务，subagent-at 这个项目 的对话模式和 native一样吗，是可以支持多次对话还是只能单次',
    '.',
    {
      candidatePaths: ['README.md', 'docs/', 'docs/a.md', 'dsh-plugin-dev/subagent-at/'],
      trace,
    },
  )
  assert.equal(paths.length, 1)
  assert.equal(paths[0].path, 'dsh-plugin-dev/subagent-at')
  assert.equal(paths[0].kind, 'directory')
  assert.equal(paths[0].mention.kind, 'bare')
  assert.equal(paths[0].mention.total, 1)
  // Other tokens (explorer, 任务, native, etc.) remain unresolved and are traced as skipped.
  assert.ok(trace.some(event =>
    event.provider === 'path-resolver'
    && event.status === 'skipped'
    && event.reason.includes('unresolved mention'),
  ))
})
