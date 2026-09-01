/** Body-line description lookup only trusts the document head, so a `description:` inside a code block or deep in the prose cannot hijack the route. */
const BODY_HEAD_LINE_LIMIT = 15

/** Minimum code-point length for a body line to count as a substantive first sentence (fallback ③). Word count is avoided because CJK text has no space tokenization. */
const MIN_SUBSTANTIVE_LENGTH = 20

/** Approximate cap (code points) for a fallback description; longer lines are cut at the last sentence boundary inside the cap. */
const MAX_DESCRIPTION_CHARS = 120

const SENTENCE_ENDERS: readonly string[] = ['.', '。', '!', '！', '?', '？', ';', '；']

/** Link or image, tolerating one level of nesting so a badge (`[![alt](img)](href)`) counts as a single token. */
const LINK_OR_IMAGE = /!?\[(?:[^[\]]|\[[^\]]*\])*\]\([^)]*\)/gu

/**
 * Extracts a one-line route description from Markdown, in priority order:
 * ① frontmatter `description:`, ② an explicit `description:` line in the document
 * head, ③ the first substantive body line as a fallback. Returns `null` when none match.
 */
export function extractDescription(content: string): string | null {
  const frontmatter = parseYamlLikeFrontmatter(content)
  const frontmatterDescription = frontmatter
    ? readDescriptionKey(frontmatter.split(/\r?\n/u))
    : null
  if (frontmatterDescription) return frontmatterDescription

  const body = frontmatter ? contentAfterFrontmatter(content) : content
  const openBodyLines = stripHtmlComments(stripCodeFences(body.split(/\r?\n/u))).slice(0, BODY_HEAD_LINE_LIMIT)

  const bodyDescription = readDescriptionKey(openBodyLines)
  if (bodyDescription) return bodyDescription

  return firstSubstantiveLine(openBodyLines)
}

/** Fallback ③: the first body line that is prose (not Markdown structure) and long enough, cleaned of inline Markdown and capped. */
function firstSubstantiveLine(lines: readonly string[]): string | null {
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (isStructuralLine(line) || isSetextTitle(lines, index)) continue
    const cleaned = cleanInlineMarkdown(line)
    if (codePointLength(cleaned) < MIN_SUBSTANTIVE_LENGTH) continue
    return truncateDescription(cleaned)
  }
  return null
}

/** A setext heading's title line sits directly above its `===`/`---` underline; skip the title, not just the underline. */
function isSetextTitle(lines: readonly string[], index: number): boolean {
  if (index + 1 >= lines.length) return false
  const trimmed = lines[index + 1].trim()
  return trimmed.length > 0 && /^(={3,}|-{3,})\s*$/u.test(trimmed)
}

/** Structural Markdown lines never carry a description; they are skipped before the length test. */
function isStructuralLine(line: string): boolean {
  const text = line.trim()
  if (text.length === 0) return true
  if (/^#{1,6}(\s|$)/u.test(text)) return true // ATX heading
  if (/^(={3,}|-{3,}|\*{3,}|_{3,})$/u.test(text)) return true // setext underline / horizontal rule
  if (/^>/u.test(text)) return true
  if (/^[-+*](\s|$)/u.test(text)) return true // unordered list
  if (/^\d{1,3}\.\s/u.test(text)) return true // ordered list
  if (text.startsWith('|') || /\s\|\s/u.test(text)) return true // table row / language-switch ("English | [中文]")
  if (/^</u.test(text)) return true
  if (isLinkOnlyLine(text)) return true // badge row / nav chrome
  return false
}

/** A line whose visible text is only links/images (badges, nav) carries no prose description. */
function isLinkOnlyLine(text: string): boolean {
  return text.length > 0 && text.replace(LINK_OR_IMAGE, '').trim().length === 0
}

/** Light inline-Markdown cleanup so a fallback line reads as plain prose. */
function cleanInlineMarkdown(line: string): string {
  return line
    .trim()
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/`([^`]*)`/gu, '$1')
    .replace(/\*\*([^*]+)\*\*/gu, '$1')
    .replace(/__([^_]+)__/gu, '$1')
    .replace(/\s+/gu, ' ')
    .replace(/[：:]\s*$/u, '')
    .trim()
}

/** Cut long fallback text at the last sentence boundary inside the cap; hard-cut (with a trailing `...`) when no boundary is deep enough. */
function truncateDescription(text: string): string {
  if (codePointLength(text) <= MAX_DESCRIPTION_CHARS) return text
  const head = [...text].slice(0, MAX_DESCRIPTION_CHARS).join('')
  const boundary = lastSentenceBoundary(head)
  if (boundary >= 0) {
    const cut = head.slice(0, boundary + 1).trimEnd()
    if (codePointLength(cut) >= MIN_SUBSTANTIVE_LENGTH) return cut
  }
  return head.trimEnd() + '...'
}

/** Last sentence ender inside `text`, skipping abbreviation dots (`ctx.`, `e.g.`). */
function lastSentenceBoundary(text: string): number {
  for (let index = text.length - 1; index >= 0; index--) {
    const char = text[index]
    if (char === '.') {
      if (isAbbreviationDot(text, index)) continue
      return index
    }
    if (SENTENCE_ENDERS.includes(char)) return index
  }
  return -1
}

function isAbbreviationDot(text: string, index: number): boolean {
  let letters = 0
  for (let prev = index - 1; prev >= 0 && prev >= index - 3; prev--) {
    if (/[a-z]/u.test(text[prev])) letters++
    else break
  }
  if (letters === 0) return false
  const next = index + 1 < text.length ? text[index + 1] : ''
  return /[a-z,;):]/u.test(next)
}

function codePointLength(text: string): number {
  return [...text].length
}

/** Drops fenced code blocks (```…``` and ~~~…~~~) so tool/program examples cannot leak `description:` matches. */
function stripCodeFences(lines: readonly string[]): string[] {
  const openLines: string[] = []
  let insideFence = false
  for (const line of lines) {
    if (isFenceLine(line)) {
      insideFence = !insideFence
      continue
    }
    if (!insideFence) openLines.push(line)
  }
  return openLines
}

function isFenceLine(line: string): boolean {
  return /^\s*(`{3,}|~{3,})/u.test(line)
}

/** Drops HTML comments (`<!--`…`-->`, possibly multi-line) so generated/boilerplate comment text cannot become the description. */
function stripHtmlComments(lines: readonly string[]): string[] {
  const openLines: string[] = []
  let insideComment = false
  for (const line of lines) {
    let rest = line
    let openPart = ''
    while (rest.length > 0) {
      if (!insideComment) {
        const start = rest.indexOf('<!--')
        if (start === -1) {
          openPart += rest
          break
        }
        openPart += rest.slice(0, start)
        rest = rest.slice(start + 4)
        insideComment = true
      } else {
        const end = rest.indexOf('-->')
        if (end === -1) {
          rest = ''
          break
        }
        rest = rest.slice(end + 3)
        insideComment = false
      }
    }
    openLines.push(openPart)
  }
  return openLines
}

function parseYamlLikeFrontmatter(content: string): string | null {
  const lines = content.split(/\r?\n/u)
  if (lines[0]?.trim() !== '---') return null
  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (endIndex === -1) return null
  return lines.slice(1, endIndex).join('\n')
}

function contentAfterFrontmatter(content: string): string {
  const lines = content.split(/\r?\n/u)
  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  return endIndex === -1 ? content : lines.slice(endIndex + 1).join('\n')
}

function readDescriptionKey(lines: readonly string[]): string | null {
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const match = line.match(/^\s*(description|decription)\s*:\s*(.*)$/iu)
    if (!match) continue

    const inline = stripYamlString(match[2].trim())
    if (inline) return inline

    const block = readIndentedBlock(lines, index + 1)
    if (block) return block
  }
  return null
}

function readIndentedBlock(lines: readonly string[], start: number): string | null {
  const collected: string[] = []
  for (let index = start; index < lines.length; index++) {
    const line = lines[index]
    if (line.trim().length === 0) {
      if (collected.length > 0) break
      continue
    }
    if (!/^\s+/.test(line)) break
    collected.push(line.trim())
  }
  return collected.length > 0 ? collected.join(' ') : null
}

function stripYamlString(value: string): string | null {
  const stripped = value
    .replace(/^\|[+-]?$/u, '')
    .replace(/^>[+-]?$/u, '')
    .trim()
  if (!stripped) return null
  const quoted = stripped.match(/^(['"])(.*)\1$/u)
  return (quoted ? quoted[2] : stripped).trim() || null
}
