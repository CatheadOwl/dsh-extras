/**
 * Fork of `deepseek-harness/scripts/markdown.ts` (upstream parse layer) —
 * copied as the md-links parse seam because the canonical lib must not import
 * upstream source (that would invert the dependency toward the parent repo,
 * the rejected A3). This copy keeps only the parse/locate primitives the lib
 * needs; fence/prose-line helpers were dropped.
 *
 * `markdownLabel` is a self-written extension (the fork locates destinations
 * only) and reuses the fork's own `labelBounds` scanner, so an upstream change
 * to that scanner must be re-copied here like any other forked primitive.
 *
 * Upstream sync: when `deepseek-harness/scripts/markdown.ts` changes these
 * primitives, re-copy them here by hand and re-run `pnpm run test`.
 * Imported mdast packages resolve from the host checkout via `link:` deps
 * (see package.json) — the "pure lib with a third-party dependency" first
 * instance in this repo.
 */

import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import type { Nodes } from 'mdast'

/** One authored Markdown line outside fenced code and rendered-away HTML comments. */
export interface MarkdownProseLine {
  /** 1-based source line number. */
  index: number
  /** Source text without normalization. */
  raw: string
}

/** One parsed Markdown heading, retaining its authored first line and rendered text. */
export interface MarkdownHeadingLine extends MarkdownProseLine {
  /** Parsed ATX or Setext heading depth. */
  depth: 1 | 2 | 3 | 4 | 5 | 6
  /** Rendered heading text, excluding raw HTML such as comments. */
  text: string
}

/** Parse GitHub-flavored Markdown with the repository's standard extensions. */
export function parseMarkdown(source: string): Nodes {
  return fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
}

/**
 * Visit a Markdown tree depth-first; returning false prunes a node's children.
 * @param node - current tree node.
 * @param visitor - callback invoked before each node's children.
 */
export function visitMarkdown(node: Nodes, visitor: (node: Nodes) => boolean | void): void {
  if (visitor(node) === false) return
  if ('children' in node) {
    for (const child of node.children) visitMarkdown(child, visitor)
  }
}

/** Markdown nodes whose authored destination occupies a replaceable source range. */
export type MarkdownDestinationNode = Extract<Nodes, { type: 'link' | 'image' | 'definition' }>

/** One authored Markdown destination and its absolute source offsets. */
export interface MarkdownDestination {
  start: number
  end: number
  url: string
}

/** Whether a Markdown URL is external, repository-root absolute, or purely in-page. */
export function isExternalOrAbsoluteMarkdownUrl(url: string): boolean {
  return url.startsWith('#')
    || url.startsWith('//')
    || url.startsWith('/')
    || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)
}

/** Split one Markdown URL without normalizing its query or fragment suffix. */
export function splitMarkdownUrlTarget(url: string): { path: string; suffix: string } {
  const boundary = url.search(/[?#]/)
  if (boundary === -1) return { path: url, suffix: '' }
  return { path: url.slice(0, boundary), suffix: url.slice(boundary) }
}

function skipWhitespace(source: string, start: number): number {
  let index = start
  while (/\s/.test(source[index] ?? '')) index += 1
  return index
}

/** Offsets of a node's `[...]` label inside its source slice: the `[` and the matching `]`. */
function labelBounds(rawNode: string): { open: number; close: number } | undefined {
  const open = rawNode.indexOf('[')
  if (open === -1) return undefined
  let depth = 0
  for (let index = open; index < rawNode.length; index += 1) {
    const char = rawNode[index]
    if (char === '\\') index += 1
    else if (char === '[') depth += 1
    else if (char === ']') {
      depth -= 1
      if (depth === 0) return { open, close: index }
    }
  }
  return undefined
}

function labelEnd(source: string): number {
  return labelBounds(source)?.close ?? -1
}

function destinationRange(rawNode: string, type: MarkdownDestinationNode['type']): { start: number; end: number } {
  const endOfLabel = labelEnd(rawNode)
  if (endOfLabel === -1) throw new Error(`markdown: cannot locate label end in ${JSON.stringify(rawNode)}`)
  let start: number
  if (type === 'definition') {
    const colon = rawNode.indexOf(':', endOfLabel + 1)
    if (colon === -1) throw new Error(`markdown: cannot locate definition separator in ${JSON.stringify(rawNode)}`)
    start = skipWhitespace(rawNode, colon + 1)
  } else {
    if (rawNode[endOfLabel + 1] !== '(') {
      throw new Error(`markdown: cannot locate inline destination in ${JSON.stringify(rawNode)}`)
    }
    start = skipWhitespace(rawNode, endOfLabel + 2)
  }
  if (rawNode[start] === '<') {
    for (let index = start + 1; index < rawNode.length; index += 1) {
      if (rawNode[index] === '\\') index += 1
      else if (rawNode[index] === '>') return { start: start + 1, end: index }
    }
    throw new Error(`markdown: cannot locate angle-bracket destination end in ${JSON.stringify(rawNode)}`)
  }
  let depth = 0
  for (let index = start; index < rawNode.length; index += 1) {
    const char = rawNode[index]
    if (char === '\\') index += 1
    else if (char === '(') depth += 1
    else if (char === ')') {
      if (depth === 0) return { start, end: index }
      depth -= 1
    } else if (/\s/.test(char ?? '') && depth === 0) {
      return { start, end: index }
    }
  }
  return { start, end: rawNode.length }
}

/** Locate one parsed destination in the original Markdown without reserializing it. */
export function markdownDestination(source: string, node: MarkdownDestinationNode): MarkdownDestination {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) {
    throw new Error(`markdown: destination ${JSON.stringify(node.url)} has no source offsets`)
  }
  const range = destinationRange(source.slice(start, end), node.type)
  const absolute = { start: start + range.start, end: start + range.end }
  return { ...absolute, url: source.slice(absolute.start, absolute.end) }
}

/** One authored Markdown label and its absolute source offsets. */
export interface MarkdownLabel {
  /** Byte offset of the first character after the opening `[`. */
  start: number
  /** Byte offset of the closing `]` (exclusive end of the label text). */
  end: number
  /** Label source text exactly as authored — markup and escapes included. */
  text: string
}

/**
 * Locate one parsed node's label in the original Markdown, the way
 * `markdownDestination` locates its destination. Textual only: whether a label
 * may be rewritten is the caller's judgment, taken next to the AST (it needs
 * the node's children and the reference kind).
 */
export function markdownLabel(source: string, node: MarkdownDestinationNode): MarkdownLabel {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) {
    throw new Error(`markdown: label ${JSON.stringify(node.type)} has no source offsets`)
  }
  const bounds = labelBounds(source.slice(start, end))
  if (bounds === undefined) {
    throw new Error(`markdown: cannot locate a label in ${JSON.stringify(source.slice(start, end))}`)
  }
  const absolute = { start: start + bounds.open + 1, end: start + bounds.close }
  return { ...absolute, text: source.slice(absolute.start, absolute.end) }
}

/** Text a reader sees from one Markdown node; raw HTML itself contributes none. */
function renderedText(node: Nodes): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value
  if (node.type === 'image' || node.type === 'imageReference') return node.alt ?? ''
  if (node.type === 'break') return ' '
  if ('children' in node) return node.children.map(child => renderedText(child)).join('')
  return ''
}

/** Return every parsed Markdown heading with its rendered text and source line. */
export function markdownHeadingLines(source: string): MarkdownHeadingLine[] {
  const rawLines = source.split('\n')
  const headings: MarkdownHeadingLine[] = []
  visitMarkdown(parseMarkdown(source), (node) => {
    if (node.type !== 'heading' || node.position === undefined) return
    headings.push({
      depth: node.depth,
      index: node.position.start.line,
      raw: rawLines[node.position.start.line - 1] ?? '',
      text: renderedText(node),
    })
  })
  return headings
}
