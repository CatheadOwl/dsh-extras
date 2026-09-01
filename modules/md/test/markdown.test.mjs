import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  markdownDestination,
  markdownHeadingLines,
  parseMarkdown,
  splitMarkdownUrlTarget,
  visitMarkdown,
} from '../lib/links/index.js'

test('parseMarkdown + visitMarkdown extract a GFM link node', () => {
  const tree = parseMarkdown('[x](a.md)')
  const links = []
  visitMarkdown(tree, (node) => {
    if (node.type === 'link') links.push(node.url)
  })
  assert.deepEqual(links, ['a.md'])
})

test('markdownDestination returns byte-exact source offsets', () => {
  const source = 'see [the docs](sub/dir.md#frag) here'
  const tree = parseMarkdown(source)
  let node
  visitMarkdown(tree, (n) => {
    if (n.type === 'link') node = n
  })
  const dest = markdownDestination(source, node)
  assert.equal(dest.url, 'sub/dir.md#frag')
  assert.equal(source.slice(dest.start, dest.end), 'sub/dir.md#frag')
})

test('markdownDestination locates an angle-bracket destination', () => {
  const source = '[a](<b.md>)'
  const tree = parseMarkdown(source)
  let node
  visitMarkdown(tree, (n) => {
    if (n.type === 'link') node = n
  })
  const dest = markdownDestination(source, node)
  assert.equal(dest.url, 'b.md')
})

test('splitMarkdownUrlTarget keeps query/fragment suffix verbatim', () => {
  assert.deepEqual(splitMarkdownUrlTarget('a.md#x?y'), { path: 'a.md', suffix: '#x?y' })
  assert.deepEqual(splitMarkdownUrlTarget('a.md'), { path: 'a.md', suffix: '' })
})

test('markdownHeadingLines renders heading text with Markdown stripped', () => {
  const source = '# Hello **world**\n\n## `code` head\n'
  const headings = markdownHeadingLines(source)
  assert.deepEqual(headings.map(h => h.text), ['Hello world', 'code head'])
  assert.deepEqual(headings.map(h => h.depth), [1, 2])
})
