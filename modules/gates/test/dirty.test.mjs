import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  accumulateDirt,
  classifyToolName,
  collectDirtFromEvents,
  compileRelevantPatterns,
  decideTurn,
  emptyDirt,
  extractChangedPath,
  gateNeedsRescan,
  toChangeSet,
} from '../lib/dirty.js'

test('classifyToolName: whitelist readonly, write/edit precise, everything else opaque', () => {
  assert.equal(classifyToolName('read'), 'readonly')
  assert.equal(classifyToolName('read_image'), 'readonly')
  assert.equal(classifyToolName('gates_run'), 'readonly')
  assert.equal(classifyToolName('ask_user_question'), 'readonly')
  assert.equal(classifyToolName('write'), 'precise')
  assert.equal(classifyToolName('edit'), 'precise')
  assert.equal(classifyToolName('bash'), 'opaque')
  assert.equal(classifyToolName('run_code'), 'opaque')
  assert.equal(classifyToolName('coggit_add'), 'opaque')
  assert.equal(classifyToolName('some_unknown_tool'), 'opaque')
})

test('extractChangedPath parses file_path defensively', () => {
  assert.equal(extractChangedPath('write', JSON.stringify({ file_path: 'docs/a.md' })), 'docs/a.md')
  assert.equal(extractChangedPath('edit', JSON.stringify({ file_path: '' })), undefined)
  assert.equal(extractChangedPath('write', '{not json'), undefined)
  assert.equal(extractChangedPath('write', undefined), undefined)
  assert.equal(extractChangedPath('bash', JSON.stringify({ file_path: 'x' })), undefined)
})

test('accumulateDirt folds calls; unparseable precise calls degrade to opaque', () => {
  const dirt = emptyDirt()
  accumulateDirt(dirt, { name: 'read', arguments: '{"file_path":"a.md"}' })
  assert.equal(dirt.paths.size, 0)
  assert.equal(dirt.opaque, false)
  accumulateDirt(dirt, { name: 'write', arguments: JSON.stringify({ file_path: 'docs/a.md' }) })
  assert.deepEqual([...dirt.paths], ['docs/a.md'])
  assert.equal(dirt.opaque, false)
  accumulateDirt(dirt, { name: 'edit', arguments: '{broken' })
  assert.equal(dirt.opaque, true)
})

test('collectDirtFromEvents scans only tool/call from startIndex and returns the next index', () => {
  const events = [
    { type: 'turn/start', data: {} },
    { type: 'tool/call', data: { name: 'write', arguments: JSON.stringify({ file_path: 'a.md' }) } },
    { type: 'tool/result', data: {} },
    { type: 'tool/call', data: { name: 'bash', arguments: '{}' } },
  ]
  const dirt = emptyDirt()
  const next = collectDirtFromEvents(events, 0, dirt)
  assert.equal(next, 4)
  assert.deepEqual([...dirt.paths], ['a.md'])
  assert.equal(dirt.opaque, true)
  // Incremental: nothing new from the returned index.
  const dirt2 = emptyDirt()
  const next2 = collectDirtFromEvents(events, next, dirt2)
  assert.equal(next2, 4)
  assert.equal(dirt2.paths.size, 0)
  assert.equal(dirt2.opaque, false)
})

test('decideTurn: first turn full, opaque full, precise dirty, clean window shortcuts', () => {
  assert.deepEqual(decideTurn(emptyDirt(), false), { kind: 'full', reason: 'first' })
  const opaque = emptyDirt(); opaque.opaque = true
  assert.deepEqual(decideTurn(opaque, true), { kind: 'full', reason: 'opaque' })
  const precise = emptyDirt(); precise.paths.add('a.md')
  assert.deepEqual(decideTurn(precise, true), { kind: 'full', reason: 'dirty' })
  assert.deepEqual(decideTurn(emptyDirt(), true), { kind: 'shortcut' })
  // No previous pass: even clean windows must scan (external-edit fallback).
  assert.deepEqual(decideTurn(emptyDirt(), false), { kind: 'full', reason: 'first' })
})

test('gateNeedsRescan: no matcher always rescans; matcher gates skip irrelevant dirt', () => {
  const mdOnly = compileRelevantPatterns(['*.md'])
  assert.equal(gateNeedsRescan(undefined, new Set(['a.md'])), true)
  assert.equal(gateNeedsRescan(mdOnly, new Set()), true)
  assert.equal(gateNeedsRescan(mdOnly, new Set(['src/a.ts'])), false)
  assert.equal(gateNeedsRescan(mdOnly, new Set(['src/a.ts', 'docs/b.md'])), true)
})

test('compileRelevantPatterns: suffix grammar, backslash normalization, substring fallback', () => {
  const matcher = compileRelevantPatterns(['*.md', 'docs\\special'])
  assert.equal(matcher('docs/a.md'), true)
  assert.equal(matcher('docs\\a.md'), true)
  assert.equal(matcher('src/a.ts'), false)
  assert.equal(matcher('x/docs/special/y.txt'), true)
  assert.equal(matcher('a.mdx'), false)
})

test('toChangeSet projects accumulated dirt into the gate-input change set', () => {
  const dirt = emptyDirt()
  dirt.paths.add('docs/a.md')
  dirt.opaque = true
  assert.deepEqual(toChangeSet(dirt), { paths: ['docs/a.md'], opaque: true })
  // Snapshot semantics: later mutation of dirt must not leak into the returned object.
  const projected = toChangeSet(dirt)
  dirt.paths.add('b.md')
  assert.deepEqual(projected, { paths: ['docs/a.md'], opaque: true })
})
