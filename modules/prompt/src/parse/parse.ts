/**
 * User-prompt text → path-candidate extraction.
 *
 * `parsePaths` is a pure recognizer pipeline: it scans text and emits every
 * token that COULD be a project path, without deciding anything. Whether a
 * candidate is a real path (and whether its ambiguity matters) is the
 * consumer's job — pair each emitted candidate with `suggestPathCandidates`.
 *
 * The v0 pipeline ships one recognizer, `ProjectRelativePathRecognizer`, which
 * extracts:
 * - tokens containing `/` or `\` (project-relative paths, backslash-normalized;
 *   a leading `/` is kept — the repository-root-relative citation anchor),
 * - a leading `@` workspace-citation marker (the host `FILE_REFERENCE_PROMPT`
 *   form): `@path`, `@path/`, `@file.md`, `@"path with spaces"`. The marker is
 *   the same workspace-root anchor as `/`, so the normalized form drops `@`
 *   and leads with `/` — the matcher's root-anchored branch never sees `@`,
 * - bare `word.ext` tokens,
 * - the inside of code spans (`` `src/x.ts` ``),
 * - the inside of quoted strings (`"docs/design notes.md"` — quoting is how a
 *   path-with-spaces is delimited),
 * - every other bare word (see the spec's "方案 A": a bare word like
 *   `handbooks` is emitted, and the consumer's fuzzy `total` decides whether
 *   it is a path).
 *
 * It excludes email addresses and URLs. New input shapes = new recognizers
 * appended to the pipeline, never changes to this trunk. (CJK boundary
 * tokenization is a deliberate base change — defect fix, not a new shape;
 * see the spec「归一化规则」and the proposal.)
 */

/** Three-tier classification of an extracted token (see spec「三档提取」). */
export type PathKind = 'dir' | 'file' | 'path' | 'bare'

export interface PathCandidate {
  /** The matched text exactly as written (quotes/backticks kept). */
  raw: string
  /** Start offset of `raw` in the input (UTF-16 code units). */
  start: number
  /** End offset of `raw` in the input (exclusive). */
  end: number
  /** Normalized form: `\` → `/`, quotes stripped, punctuation/trailing slash stripped. */
  normalized: string
  /** Three-tier kind: `dir` (trailing slash) / `file` (leaf extension) / `path` (separator) / `bare` (none). */
  kind: PathKind
}

export interface PathRecognizer {
  /** Stable recognizer id, used for debugging / logging. */
  name: string
  scan(text: string): PathCandidate[]
}

/**
 * Extract path candidates from `text`. `recognizers` defaults to the v0
 * pipeline `[new ProjectRelativePathRecognizer()]`. Results are concatenated
 * and stably sorted by `start` offset (recognizer order breaks ties).
 */
export function parsePaths(text: string, recognizers?: PathRecognizer[]): PathCandidate[] {
  const active = recognizers ?? [new ProjectRelativePathRecognizer()]
  const out: PathCandidate[] = []
  for (const recognizer of active) {
    out.push(...recognizer.scan(text))
  }
  out.sort((a, b) => a.start - b.start)
  return out
}

/** v0 recognizer: project-relative path shapes, plus bare words (方案 A). */
export class ProjectRelativePathRecognizer implements PathRecognizer {
  readonly name = 'project-relative-path'

  scan(text: string): PathCandidate[] {
    const candidates: PathCandidate[] = []
    // CJK boundary tokenization: Han chars and full-width punctuation
    // (U+3000–U+303F CJK Symbols, U+FF00–U+FFEF Halfwidth/Fullwidth Forms)
    // act as token boundaries so `explorer任务，subagent-at` splits into
    // `explorer` / `任务` / `subagent-at` instead of one fused token.
    // Han segments are kept as bare tokens (total=0 → discarded, same as before).
    // RegExp constructor (not literal) so `\n` stays a regex escape, not a source newline.
    const token = new RegExp(
      '`[^`\\n]*`|@"[^"\\n]*"|"[^"\\n]*"|\'[^\'\\n]*\'|[\\p{Script=Han}]+|[^\\s\\p{Script=Han}\\u3000-\\u303F\\uFF00-\\uFFEF]+',
      'gu',
    )
    let match: RegExpExecArray | null
    while ((match = token.exec(text)) !== null) {
      const raw = match[0]
      const candidate = this.classify(raw, match.index)
      if (candidate !== null) {
        candidates.push(candidate)
      }
    }
    return candidates
  }

  private classify(raw: string, start: number): PathCandidate | null {
    // A leading `@` is the workspace-citation marker (host FILE_REFERENCE_PROMPT):
    // strip it and root-anchor the remainder. `@` and `/` are the same root
    // anchor spelled two ways, so `@workunits/md-fabric/` normalizes to
    // `/workunits/md-fabric` and rides the matcher's root-anchored branch.
    const cited = raw.startsWith('@')
    const body = cited ? raw.slice(1) : raw
    if (body === '') {
      return null
    }
    const first = body[0]
    // Only treat a token as a delimited (code-span / quoted) form when its
    // delimiter is actually balanced; an unbalanced one falls through to the
    // bare branch so `slice(1, -1)` never chops a real character.
    const balanced = body.length >= 2 && body[body.length - 1] === first
      && (first === '`' || first === '"' || first === "'")
    if (!balanced) {
      return this.classifyBare(raw, start, body, cited)
    }
    const inner = body.slice(1, -1)
    if (first === '`') {
      // Code span: only a single non-whitespace inner is a path token.
      const trimmed = inner.trim()
      if (trimmed === '' || /\s/u.test(trimmed)) {
        return null
      }
      return this.classifyInner(raw, start, trimmed, cited)
    }
    // Quoted string: the delimiter for a path-with-spaces.
    if (inner.trim() === '') {
      return null
    }
    return this.classifyInner(raw, start, inner, cited)
  }

  private classifyInner(raw: string, start: number, inner: string, cited = false): PathCandidate | null {
    const normalized = normalizeInner(inner)
    if (normalized === '' || isUrl(normalized) || isEmail(normalized)) {
      return null
    }
    return makeCandidate(raw, start, cited ? `/${normalized}` : normalized)
  }

  private classifyBare(raw: string, start: number, body: string, cited = false): PathCandidate | null {
    const normalized = normalizeInner(body)
    if (normalized === '' || isUrl(normalized) || isEmail(normalized)) {
      return null
    }
    return makeCandidate(raw, start, cited ? `/${normalized}` : normalized)
  }
}

function makeCandidate(raw: string, start: number, normalized: string): PathCandidate | null {
  const { normalized: norm, kind } = classifyKind(normalized)
  if (norm === '') {
    return null
  }
  return { raw, start, end: start + raw.length, normalized: norm, kind }
}

/**
 * Classify the token's path shape and strip a directory's trailing slash.
 * Shape-only: delimiters (code span / quotes) affect token boundaries, not kind.
 * - trailing `/` → `dir` (slash stripped so the matcher's `tail.join('/') === query`
 *   is not defeated by the query keeping its slash)
 * - leaf carries a real extension (`README.md`, `notes.md`) → `file`
 * - contains `/` → `path`
 * - otherwise → `bare` (a hidden dotfile like `.gitignore` or `.`/`..` is `bare`:
 *   its dot is a leading dot, not a name-ext boundary)
 */
function classifyKind(normalized: string): { normalized: string; kind: PathKind } {
  if (normalized.endsWith('/')) {
    return { normalized: normalized.replace(/\/+$/u, ''), kind: 'dir' }
  }
  const leaf = normalized.split('/').pop() ?? normalized
  if (leaf.includes('.') && !leaf.startsWith('.')) {
    return { normalized, kind: 'file' }
  }
  if (normalized.includes('/')) {
    return { normalized, kind: 'path' }
  }
  return { normalized, kind: 'bare' }
}

/** `\` → `/`, trim, strip a leading `./`, strip trailing punctuation. Never resolves or decides. A leading `/` is KEPT: it is the root anchor of the repository-root-relative citation form (see the workunit spec「根锚定」), not a prefix to strip like `./`. */
function normalizeInner(inner: string): string {
  let out = inner.replace(/\\/g, '/')
  out = out.trim()
  out = stripLeadingDotSlash(out)
  return stripTrailingPunctuation(out)
}

/**
 * Strip a leading `./` (current-directory prefix) so `./handbooks` and
 * `./handbooks/` normalize to `handbooks` and match like the bare form.
 * `../` is preserved (relative-parent stays a literal segment; the consumer
 * guards escaping the project root). A lone `./`/`..` is left untouched here
 * and handled downstream.
 */
function stripLeadingDotSlash(s: string): string {
  let out = s
  while (out.startsWith('./')) {
    out = out.slice(2)
  }
  return out
}

/**
 * Strip trailing `,` / `;`, then a sentence-final `.` (a lone trailing dot
 * that is not part of a `..` relative-parent reference). `README.md` keeps its
 * extension dot; `README.` loses the sentence dot; `..` is preserved.
 */
function stripTrailingPunctuation(s: string): string {
  let out = s.replace(/[,;]+$/u, '')
  if (/\.$/.test(out) && !/\.\.$/u.test(out)) {
    out = out.slice(0, -1)
  }
  return out
}

function isUrl(s: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//u.test(s)
}

function isEmail(s: string): boolean {
  return /^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/u.test(s)
}
