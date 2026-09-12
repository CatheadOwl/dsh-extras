import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  markdownDestination,
  markdownHeadingLines,
  markdownLabel,
  parseMarkdown,
  splitMarkdownUrlTarget,
  visitMarkdown,
} from '../lib/links/index.js'

function firstNode(source, type) {
  let found
  visitMarkdown(parseMarkdown(source), (node) => {
    if (node.type === type) found = node
  })
  return found
}

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

test('markdownLabel returns the label byte range of a link', () => {
  const source = 'see [the docs](sub/dir.md) here'
  const label = markdownLabel(source, firstNode(source, 'link'))
  assert.equal(label.text, 'the docs')
  assert.equal(source.slice(label.start, label.end), 'the docs')
})

test('markdownLabel locates an image alt and a definition key', () => {
  const image = '![arch](assets/a.png)'
  assert.equal(markdownLabel(image, firstNode(image, 'image')).text, 'arch')

  const definition = '[manual]: docs/manual.md'
  assert.equal(markdownLabel(definition, firstNode(definition, 'definition')).text, 'manual')
})

test('markdownLabel skips an escaped bracket instead of ending the label there', () => {
  const source = '[a\\]b](x.md)'
  const label = markdownLabel(source, firstNode(source, 'link'))
  assert.equal(label.text, 'a\\]b')
  assert.equal(source.slice(label.start, label.end), 'a\\]b')
})

test('markdownHeadingLines renders heading text with Markdown stripped', () => {
  const source = '# Hello **world**\n\n## `code` head\n'
  const headings = markdownHeadingLines(source)
  assert.deepEqual(headings.map(h => h.text), ['Hello world', 'code head'])
  assert.deepEqual(headings.map(h => h.depth), [1, 2])
})
