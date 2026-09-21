import test from 'node:test'
import assert from 'node:assert/strict'

import { ANY_ROUTES_DESCRIPTION } from '../lib/tool-description.js'

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

test('description documents the response anchor invariant (anchor was the one field every reviewer marked uncertain)', () => {
  assert.ok(
    ANY_ROUTES_DESCRIPTION.includes('`anchor` the absolute route root'),
    'the description must state what anchor is: the absolute route root the view is anchored at',
  )
})

test('description defines the flat ` | ` split grammar (descriptions may themselves contain the separator)', () => {
  assert.ok(
    ANY_ROUTES_DESCRIPTION.includes('everything after the FIRST ` | ` is the description'),
    'the description must define the first-separator split so a description containing ` | ` stays parseable',
  )
})

test('description states description provenance (frontmatter → head description line → first substantive line)', () => {
  assert.ok(
    ANY_ROUTES_DESCRIPTION.includes('frontmatter `description:`'),
    'the description must state where descriptions come from',
  )
})

test('description states the Markdown-empty folder omission rule', () => {
  assert.ok(
    ANY_ROUTES_DESCRIPTION.includes('`[truncated: 0]` never appears'),
    'the description must state that folders with no Markdown content under them are omitted entirely',
  )
})

test('description states filter visibility and the loud maxFiles cutoff', () => {
  assert.ok(
    ANY_ROUTES_DESCRIPTION.includes('apply without an echo') && ANY_ROUTES_DESCRIPTION.includes('`diagnostics`'),
    'the description must state that traversal filters are not echoed while the maxFiles cutoff reports a diagnostics warning',
  )
})
