import assert from 'node:assert/strict'
import { test } from 'node:test'

import * as rootFace from '../lib/index.js'

test('root entry exports only the dsh loader contract', () => {
  assert.deepEqual([...Object.keys(rootFace).sort()], ['Config', 'apply', 'inject', 'name'])
})
