import test from 'node:test'
import assert from 'node:assert/strict'

import { ANY_ROUTES_DESCRIPTION } from '../lib/index.js'

test('description states the truncated-folder | description suffix (anti-#2 regression)', () => {
  assert.ok(
    ANY_ROUTES_DESCRIPTION.includes('truncated folder rendered as `[truncated: N] folder-path` (with ` | description`'),
    'the description must mirror the projection, which renders truncated folders with a ` | description` suffix when their README has one',
  )
})

test('description carries the never-file-content boundary', () => {
  assert.ok(
    ANY_ROUTES_DESCRIPTION.includes('never file content'),
    'the description must state that the router returns no file content',
  )
})

test('description leaks no next-hint (other tool names + imperative)', () => {
  const hintPatterns = [/use (read|grep|glob)/iu, /then (read|grep|glob)/iu, /call (read|grep|glob)/iu, /next,? (read|grep|glob)/iu]
  for (const pattern of hintPatterns) {
    assert.ok(!pattern.test(ANY_ROUTES_DESCRIPTION), `description must not contain a next-hint matching ${pattern}`)
  }
})
