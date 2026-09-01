import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { loadProjectGates, materializeGates, parseProjectGatesYaml } from '../lib/repo-gates.js'
import { mergeGateDefinitions } from '../lib/service.js'

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url))

test('entries declaring neither module nor command fail loud', () => {
  assert.throws(() => materializeGates([{ id: 'bare' }]), /neither module nor command/)
})

test('materialized definitions pass the same vocabulary validation as registered ones', () => {
  // `on` is hard-coded by materialization (not user-declarable), so only
  // `level` can carry a vocabulary typo from gates.yml.
  assert.throws(() => materializeGates([{ id: 'typo-level', module: 'm.mjs', level: 'Blocking' }]), /unknown level/)
})

test('materialized project gates reject duplicate and reserved ids', () => {
  assert.throws(() => materializeGates([
    { id: 'dupe', module: 'a.mjs' },
    { id: 'dupe', module: 'b.mjs' },
  ]), /declared more than once/)
  assert.throws(() => materializeGates([{ id: 'gates-config', module: 'm.mjs' }]), /reserved/)
})

test('materialized project gates carry a defer fixer onto the definition', () => {
  const [gate] = materializeGates([{
    id: 'md-metadata',
    module: 'm.mjs',
    level: 'defer',
    fixer: { kind: 'subagent', prompt: 'add descriptions' },
  }])
  assert.equal(gate.level, 'defer')
  assert.deepEqual(gate.fixer, { kind: 'subagent', prompt: 'add descriptions' })
})

test('materialized project gates carry a command fixer onto the definition', () => {
  const [gate] = materializeGates([{
    id: 'normalize',
    module: 'm.mjs',
    level: 'defer',
    fixer: { kind: 'command', command: 'node scripts/normalize.mjs' },
  }])
  assert.equal(gate.level, 'defer')
  assert.deepEqual(gate.fixer, { kind: 'command', command: 'node scripts/normalize.mjs' })
})

test('materialized project gates fail loud on a fixer declared for a non-defer level', () => {
  assert.throws(
    () => materializeGates([{ id: 'blocking-fixer', module: 'm.mjs', fixer: { kind: 'subagent', prompt: 'x' } }]),
    /fixer.*defer/,
  )
})

test('merged definitions reject plugin/project id collisions without returning duplicate gates', () => {
  const plugin = {
    id: 'same',
    description: 'plugin gate',
    rationale: 'why',
    on: ['stop'],
    level: 'blocking',
    check: async () => [],
  }
  const project = { ...plugin, description: 'project gate' }
  const merged = mergeGateDefinitions([plugin], [project])
  assert.equal(merged.definitions.length, 1)
  assert.equal(merged.definitions[0], plugin)
  assert.match(merged.error, /already registered/)
})

test('module gate resolves relative module paths against the workspace root', async () => {
  const [gate] = materializeGates([{ id: 'rel', module: 'test/fixtures/generic-check.mjs' }])
  // Package root so the relative spec reaches the fixture under test/fixtures.
  const root = fileURLToPath(new URL('..', import.meta.url))
  const violations = await gate.check(root)
  assert.equal(violations.length, 1)
  assert.match(violations[0].reason, /generic saw/)
})

test('module gate reports a missing module as a violation, not a crash', async () => {
  const [gate] = materializeGates([{ id: 'ghost', module: 'does/not/exist.mjs' }])
  const violations = await gate.check('.')
  assert.equal(violations.length, 1)
  assert.match(violations[0].reason, /gate module not found/)
})

test('module gate accepts the generic check(root) surface', async () => {
  const generic = fileURLToPath(new URL('./fixtures/generic-check.mjs', import.meta.url))
  const [gate] = materializeGates([{ id: 'generic', module: generic, level: 'advisory' }])
  assert.equal(gate.level, 'advisory')
  const violations = await gate.check('/any/root')
  assert.deepEqual(violations, [{ reason: 'generic saw /any/root' }])
})

test('module gate forwards the change set to the generic check surface', async () => {
  const generic = fileURLToPath(new URL('./fixtures/generic-check-changes.mjs', import.meta.url))
  const [gate] = materializeGates([{ id: 'gc', module: generic }])
  const changes = { paths: ['x.md'], opaque: true }
  const violations = await gate.check('/root', changes)
  assert.equal(violations.length, 1)
  assert.match(violations[0].reason, /"paths":\["x\.md"\]/)
  assert.match(violations[0].reason, /"opaque":true/)
})

test('parseProjectGatesYaml accepts empty documents and rejects wrong shapes', () => {
  assert.deepEqual(parseProjectGatesYaml(''), [])
  assert.deepEqual(parseProjectGatesYaml('other: 1'), [])
  assert.throws(() => parseProjectGatesYaml('gates: not-a-list'), /must be a list/)
  assert.throws(() => parseProjectGatesYaml('- a\n- b'), /must be a mapping with a 'gates' list/)
  assert.throws(() => parseProjectGatesYaml('gates:\n  - just-a-string'), /must be a mapping/)
  const entries = parseProjectGatesYaml('gates:\n  - id: x\n    module: m.mjs')
  assert.deepEqual(entries, [{ id: 'x', module: 'm.mjs' }])
})

test('loadProjectGates loads a project gates.yml relative to the given root', async () => {
  const root = fileURLToPath(new URL('./fixtures/project-with-gates', import.meta.url))
  const { definitions, error } = loadProjectGates(root)
  assert.equal(error, undefined)
  assert.equal(definitions.length, 1)
  assert.equal(definitions[0].id, 'fixture-check')
  const violations = await definitions[0].check(root)
  assert.equal(violations.length, 1)
  assert.match(violations[0].reason, /fixture saw/)
})

test('loadProjectGates returns empty for a workspace without gates.yml', () => {
  const { definitions, error } = loadProjectGates(fixturesDir)
  assert.deepEqual(definitions, [])
  assert.equal(error, undefined)
})

test('loadProjectGates reports a broken gates.yml as an error, not a crash', () => {
  const root = fileURLToPath(new URL('./fixtures/project-with-bad-gates', import.meta.url))
  const { definitions, error } = loadProjectGates(root)
  assert.deepEqual(definitions, [])
  assert.notEqual(error, undefined)
})

test('loadProjectGates surfaces vocabulary typos instead of silently demoting gates', () => {
  const root = fileURLToPath(new URL('./fixtures/project-with-bad-vocab', import.meta.url))
  const { definitions, error } = loadProjectGates(root)
  assert.deepEqual(definitions, [])
  assert.match(error, /unknown level/)
})
