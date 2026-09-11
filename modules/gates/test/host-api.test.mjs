import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Session } from '@deepseek-ai/dsh-session'

import { assertHostSessionApi } from '../lib/host-api.js'

test('assertHostSessionApi passes against the real host Session', () => {
  // The junction-resolved host class carries snapshotEvents (upstream
  // 5660f44d29 onward); this pins the consumption point the turn-stopping
  // driver depends on.
  assert.doesNotThrow(assertHostSessionApi)
})

test('assertHostSessionApi fails loud with a named host-version error', () => {
  const proto = Session.prototype
  const original = Object.getOwnPropertyDescriptor(proto, 'snapshotEvents')
  try {
    delete proto.snapshotEvents
    assert.throws(assertHostSessionApi, /host dsh is too old[\s\S]*snapshotEvents/)
  } finally {
    if (original !== undefined) Object.defineProperty(proto, 'snapshotEvents', original)
  }
})
