import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { extractReferences, rebaseDestination, rebaseLabel } from '../lib/links/index.js'

describe('rebaseDestination (byte-preserving)', () => {
  it('rewrites only the destination substring, preserving the fragment suffix', () => {
    const source = '[x](docs/a.md#Section)\n'
    const [ref] = extractReferences(source)
    assert.equal(rebaseDestination(source, ref, 'notes/b.md'), '[x](notes/b.md#Section)\n')
  })

  it('preserves a query suffix verbatim', () => {
    const source = '[x](docs/a.md?v=2)\n'
    const [ref] = extractReferences(source)
    assert.equal(rebaseDestination(source, ref, 'notes/b.md'), '[x](notes/b.md?v=2)\n')
  })

  it('preserves a fragment+query suffix verbatim', () => {
    const source = '[x](docs/a.md#S?q=1)\n'
    const [ref] = extractReferences(source)
    assert.equal(rebaseDestination(source, ref, 'notes/b.md'), '[x](notes/b.md#S?q=1)\n')
  })

  it('keeps angle brackets around a rewritten angle-bracket destination', () => {
    const source = '[x](<docs/a.md#S>)\n'
    const [ref] = extractReferences(source)
    assert.equal(rebaseDestination(source, ref, 'notes/b.md'), '[x](<notes/b.md#S>)\n')
  })

  it('leaves every byte outside the destination untouched', () => {
    const source = 'before [x](docs/a.md) after\n'
    const [ref] = extractReferences(source)
    assert.equal(rebaseDestination(source, ref, 'notes/b.md'), 'before [x](notes/b.md) after\n')
  })
})

describe('rebaseLabel (byte-preserving)', () => {
  it('rewrites only the label substring', () => {
    const source = '[docs/a.md](docs/a.md#S)\n'
    const [ref] = extractReferences(source)
    assert.equal(ref.label.text, 'docs/a.md')
    assert.equal(rebaseLabel(source, ref, 'docs/b.md'), '[docs/b.md](docs/a.md#S)\n')
  })

  it('composes with the destination splice on the same reference', () => {
    const source = 'x [docs/a.md](docs/a.md) y\n'
    const [ref] = extractReferences(source)
    // The label sits before the destination, so destination-first is descending
    // order and both offsets stay valid — the rule `applyRebase` relies on.
    const rebased = rebaseDestination(source, ref, 'notes/b.md')
    assert.equal(rebaseLabel(rebased, ref, 'notes/b.md'), 'x [notes/b.md](notes/b.md) y\n')
  })

  it('fails fast on a reference with no located label', () => {
    const source = '[guide]: docs/a.md\n'
    const [ref] = extractReferences(source)
    assert.equal(ref.kind, 'definition')
    assert.equal(ref.label, undefined)
    assert.throws(() => rebaseLabel(source, ref, 'x'), /not relabelable/)
  })
})
