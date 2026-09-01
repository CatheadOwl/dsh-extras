import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { extractReferences, rebaseDestination } from '../lib/links/index.js'

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
