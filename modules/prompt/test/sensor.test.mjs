// Sensor lane unit tests: closed-set extraction, admission, ancestor
// up-float, path normalization, and the runner's pending-set lifecycle
// (record → take clears; turn-boundary discard; per-session isolation).
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PromptMiddlewareRunner } from '../lib/core.js'
import { normalizeTouchPath, touchPathFromExecution, TouchFloatQueue } from '../lib/sensor.js'

let nextToken = 0
function token() {
  return Symbol(`touch-${nextToken++}`)
}

function exec({
  name = 'read',
  filePath = 'D:\\proj\\docs\\guide.md',
  hasAgent = true,
  parent,
  aborted = false,
} = {}) {
  return {
    name,
    arguments: filePath === undefined ? {} : { file_path: filePath },
    token: token(),
    ...(parent !== undefined ? { parent } : {}),
    ...(hasAgent ? { agent: { session: { id: 's1', header: { cwd: 'D:\\proj' } } } } : {}),
    signal: { aborted },
  }
}

test('touchPathFromExecution admits read and edit with a usable file_path', () => {
  assert.equal(touchPathFromExecution(exec({ name: 'read', filePath: 'a.md' }))?.length > 0, true)
  assert.equal(touchPathFromExecution(exec({ name: 'edit', filePath: 'a.md' }))?.length > 0, true)
})

test('touchPathFromExecution rejects tools outside the closed set', () => {
  assert.equal(touchPathFromExecution(exec({ name: 'write', filePath: 'a.md' })), undefined)
  assert.equal(touchPathFromExecution(exec({ name: 'bash', filePath: 'a.md' })), undefined)
})

test('touchPathFromExecution rejects malformed file_path values', () => {
  assert.equal(touchPathFromExecution(exec({ filePath: '' })), undefined)
  assert.equal(touchPathFromExecution(exec({ filePath: '   ' })), undefined)
  assert.equal(touchPathFromExecution(exec({ filePath: null })), undefined)
  const numeric = exec()
  numeric.arguments = { file_path: 42 }
  assert.equal(touchPathFromExecution(numeric), undefined)
  const nullArgs = exec()
  nullArgs.arguments = null
  assert.equal(touchPathFromExecution(nullArgs), undefined)
})

test('normalizeTouchPath lands in the project-relative key space', () => {
  assert.equal(normalizeTouchPath('D:\\proj\\docs\\guide.md', 'D:\\proj'), 'docs/guide.md')
  assert.equal(normalizeTouchPath('D:/proj/docs/', 'D:\\proj'), 'docs')
  assert.equal(normalizeTouchPath('docs\\guide.md', 'D:\\proj'), 'docs/guide.md')
  // Outside the project: stays absolute, still slash-canonicalized.
  assert.equal(normalizeTouchPath('E:\\other\\x.md', 'D:\\proj'), 'E:/other/x.md')
})

test('normalizeTouchPath compares Windows drive-letter prefixes case-insensitively', () => {
  assert.equal(normalizeTouchPath('d:\\PROJ\\docs\\guide.md', 'D:\\proj'), 'docs/guide.md')
  assert.equal(normalizeTouchPath('D:/Proj/docs/guide.md', 'd:/pROJ'), 'docs/guide.md')
  // Different drive stays absolute.
  assert.equal(normalizeTouchPath('e:/proj/x.md', 'D:\\proj'), 'e:/proj/x.md')
})

test('settle returns the root touch, normalized against the session cwd', () => {
  const queue = new TouchFloatQueue()
  const touches = queue.settle(exec(), false, 'D:\\proj')
  assert.deepEqual(touches, [{ path: 'docs/guide.md', tool: 'read' }])
})

test('settle excludes error, agent-less, and aborted executions', () => {
  const queue = new TouchFloatQueue()
  assert.deepEqual(queue.settle(exec(), true, 'D:\\proj'), [])
  assert.deepEqual(queue.settle(exec({ hasAgent: false }), false, 'D:\\proj'), [])
  assert.deepEqual(queue.settle(exec({ aborted: true }), false, 'D:\\proj'), [])
})

test('a nested execution floats to its parent and settles once at the root', () => {
  const queue = new TouchFloatQueue()
  const parentToken = token()
  const child = exec({ filePath: 'D:\\proj\\src\\a.ts' })
  child.parent = parentToken
  assert.deepEqual(queue.settle(child, false, 'D:\\proj'), [], 'nested settle floats, records nothing')

  const root = exec({ name: 'edit', filePath: 'D:\\proj\\src\\main.ts' })
  root.token = parentToken
  const touches = queue.settle(root, false, 'D:\\proj')
  assert.deepEqual(touches, [
    { path: 'src/a.ts', tool: 'read' },
    { path: 'src/main.ts', tool: 'edit' },
  ], 'child touch settles at the root exactly once, root own touch included')
})

test('a floated touch reaching an agent-less root is returned — the caller owns dropping it', () => {
  const queue = new TouchFloatQueue()
  const parentToken = token()
  const child = exec({ filePath: 'D:\\proj\\src\\a.ts' })
  child.parent = parentToken
  queue.settle(child, false, 'D:\\proj')
  const agentlessRoot = exec({ hasAgent: false })
  agentlessRoot.token = parentToken
  // The queue cannot know about sessions; the driver drops these because no
  // session can own the recording.
  assert.deepEqual(queue.settle(agentlessRoot, false, 'D:\\proj'), [{ path: 'src/a.ts', tool: 'read' }])
})

test('runner pending: record then take returns and clears', () => {
  const runner = new PromptMiddlewareRunner()
  runner.recordTouch('s1', { path: 'docs/guide.md', tool: 'read' }, { cwd: '/proj' })
  assert.deepEqual(runner.takePendingTouches('s1'), [{ path: 'docs/guide.md', tool: 'read' }])
  assert.deepEqual(runner.takePendingTouches('s1'), [], 'take clears the pending set')
  assert.deepEqual(runner.takePendingTouches('unknown'), [], 'unknown session has no pending touches')
})

test('runner pending: turn-boundary discard drops residuals', () => {
  const runner = new PromptMiddlewareRunner()
  runner.recordTouch('s1', { path: 'docs/guide.md', tool: 'read' }, { cwd: '/proj' })
  runner.discardPendingTouches('s1')
  assert.deepEqual(runner.takePendingTouches('s1'), [])
})

test('runner pending: sessions are isolated', () => {
  const runner = new PromptMiddlewareRunner()
  runner.recordTouch('s1', { path: 'a.md', tool: 'read' }, { cwd: '/proj' })
  runner.recordTouch('s2', { path: 'b.md', tool: 'edit' }, { cwd: '/proj' })
  assert.deepEqual(runner.takePendingTouches('s1'), [{ path: 'a.md', tool: 'read' }])
  assert.deepEqual(runner.takePendingTouches('s2'), [{ path: 'b.md', tool: 'edit' }])
})

test('runner pending: clearSession (surface replace) leaves turn-scoped touches alone', () => {
  const runner = new PromptMiddlewareRunner()
  runner.recordTouch('s1', { path: 'a.md', tool: 'read' }, { cwd: '/proj' })
  runner.clearSession('s1')
  assert.deepEqual(runner.takePendingTouches('s1'), [{ path: 'a.md', tool: 'read' }])
})
