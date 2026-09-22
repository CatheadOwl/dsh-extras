import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parsePaths, ProjectRelativePathRecognizer } from '../lib/parse/parse.js'

function normalized(text) {
  return parsePaths(text).map((candidate) => candidate.normalized)
}

test('extracts a slash-separated relative path', () => {
  assert.deepEqual(normalized('open handbooks/dsh-hooks'), ['open', 'handbooks/dsh-hooks'])
})

test('normalizes backslashes to forward slashes', () => {
  assert.deepEqual(normalized('open handbooks\\dsh-hooks'), ['open', 'handbooks/dsh-hooks'])
  assert.deepEqual(normalized('handbooks\\dsh-hooks.md'), ['handbooks/dsh-hooks.md'])
})

test('extracts the inside of a quoted path-with-spaces', () => {
  const result = parsePaths('see "docs/design notes.md" please')
  // 方案 A: surrounding bare words are candidates too.
  assert.deepEqual(result.map((candidate) => candidate.normalized), ['see', 'docs/design notes.md', 'please'])
  assert.equal(result[1].raw, '"docs/design notes.md"')
  assert.equal(result[1].start, 4)
  assert.equal(result[1].end, 26)
})

test('extracts the inside of a code span', () => {
  const result = parsePaths('check `src/x.ts`')
  assert.deepEqual(result.map((candidate) => candidate.normalized), ['check', 'src/x.ts'])
  assert.equal(result[1].raw, '`src/x.ts`')
})

test('skips a code span that wraps prose (contains whitespace)', () => {
  assert.deepEqual(normalized('`some code here`'), [])
})

test('excludes email addresses', () => {
  assert.deepEqual(normalized('mail me at a@b.test'), ['mail', 'me', 'at'])
})

test('excludes URLs', () => {
  assert.deepEqual(normalized('see https://example.com/x'), ['see'])
})

test('excludes quoted email and URL forms too', () => {
  assert.deepEqual(normalized('see "a@b.test" now'), ['see', 'now'])
  assert.deepEqual(normalized('see "https://example.com/x" now'), ['see', 'now'])
})

test('skips a balanced delimiter that unwraps to empty', () => {
  assert.deepEqual(normalized('x "," y'), ['x', 'y'])
})

test('keeps relative parent semantics', () => {
  assert.deepEqual(normalized('../outside'), ['../outside'])
})

test('strips a leading ./ prefix', () => {
  assert.deepEqual(
    parsePaths('./handbooks').map((c) => [c.normalized, c.kind]),
    [['handbooks', 'bare']],
  )
})

test('strips a leading ./ before a trailing slash (dir specifier)', () => {
  assert.deepEqual(
    parsePaths('./handbooks/').map((c) => [c.normalized, c.kind]),
    [['handbooks', 'dir']],
  )
})

test('strips ./ but keeps ../ (relative parent stays a literal segment)', () => {
  assert.deepEqual(normalized('./../outside'), ['../outside'])
})

test('keeps a bare extensioned word', () => {
  assert.deepEqual(normalized('README.md'), ['README.md'])
})

test('emits a bare word as a candidate (scheme A)', () => {
  assert.deepEqual(normalized('handbooks'), ['handbooks'])
})

test('strips trailing punctuation', () => {
  assert.deepEqual(normalized('open README.md,'), ['open', 'README.md'])
  assert.deepEqual(normalized('open README.md;'), ['open', 'README.md'])
  assert.deepEqual(normalized('open src/x.ts.'), ['open', 'src/x.ts'])
})

test('preserves a trailing relative-parent reference', () => {
  assert.deepEqual(normalized('go ..'), ['go', '..'])
})

test('does not corrupt an unbalanced delimiter (falls back to bare token)', () => {
  // A missing closing quote/backtick must not chop a real character off.
  assert.deepEqual(parsePaths('"foo bar').map((candidate) => candidate.normalized), ['"foo', 'bar'])
  assert.deepEqual(parsePaths('`src/x.ts').map((candidate) => candidate.normalized), ['`src/x.ts'])
})

test('reports raw text and offsets for each candidate', () => {
  const result = parsePaths('a/b c')
  assert.deepEqual(
    result.map((candidate) => [candidate.raw, candidate.start, candidate.end, candidate.normalized, candidate.kind]),
    [
      ['a/b', 0, 3, 'a/b', 'path'],
      ['c', 4, 5, 'c', 'bare'],
    ],
  )
})

test('classifies kind: dir from a trailing slash (slash stripped)', () => {
  assert.deepEqual(
    parsePaths('handbooks/').map((c) => [c.normalized, c.kind]),
    [['handbooks', 'dir']],
  )
})

test('classifies kind: file from a leaf extension', () => {
  assert.deepEqual(parsePaths('README.md').map((c) => [c.normalized, c.kind]), [['README.md', 'file']])
  assert.deepEqual(
    parsePaths('spec/path-extraction-scope.md').map((c) => [c.normalized, c.kind]),
    [['spec/path-extraction-scope.md', 'file']],
  )
})

test('classifies kind: path from a separator without extension', () => {
  assert.deepEqual(
    parsePaths('handbooks/dsh-hooks').map((c) => [c.normalized, c.kind]),
    [['handbooks/dsh-hooks', 'path']],
  )
})

test('classifies kind: bare from a separator-less, extension-less word', () => {
  assert.deepEqual(parsePaths('handbooks').map((c) => [c.normalized, c.kind]), [['handbooks', 'bare']])
})

test('classifies a hidden dotfile as bare (no real name-ext boundary)', () => {
  assert.deepEqual(parsePaths('.gitignore').map((c) => [c.normalized, c.kind]), [['.gitignore', 'bare']])
})

test('accepts a custom recognizer pipeline', () => {
  const upper = {
    name: 'upper',
    scan(text) {
      return [...text.matchAll(/[A-Z]+/g)].map((m) => ({
        raw: m[0],
        start: m.index,
        end: m.index + m[0].length,
        normalized: m[0].toLowerCase(),
        kind: 'bare',
      }))
    },
  }
  assert.deepEqual(parsePaths('foo BAR baz', [upper]).map((candidate) => candidate.normalized), ['bar'])
})

test('the default recognizer names itself', () => {
  assert.equal(new ProjectRelativePathRecognizer().name, 'project-relative-path')
})

// --- repository-root-relative (`/`-prefixed) citations ---

test('keeps a leading / as the root anchor (not stripped like ./)', () => {
  assert.deepEqual(
    parsePaths('/handbooks').map((c) => [c.normalized, c.kind]),
    [['/handbooks', 'path']],
  )
  assert.deepEqual(
    parsePaths('/README.md').map((c) => [c.normalized, c.kind]),
    [['/README.md', 'file']],
  )
})

test('classifies a rooted dir specifier: trailing slash stripped, anchor kept', () => {
  assert.deepEqual(
    parsePaths('/handbooks/').map((c) => [c.normalized, c.kind]),
    [['/handbooks', 'dir']],
  )
})

test('extracts a rooted citation inside quotes and code spans', () => {
  assert.deepEqual(normalized('see "/workunits/md-fabric/README.md"'), ['see', '/workunits/md-fabric/README.md'])
  assert.deepEqual(normalized('check `/dsh-plugin-dev/prompt-parse`'), ['check', '/dsh-plugin-dev/prompt-parse'])
})

// --- workspace-citation (`@`-prefixed) references ---
// The host FILE_REFERENCE_PROMPT spells the workspace-root anchor with `@`
// instead of `/`; the recognizer canonicalizes both to the same `/` root anchor.

test('@ citation: strips the marker and root-anchors (dir / path / file)', () => {
  assert.deepEqual(
    parsePaths('@workunits/md-fabric/').map((c) => [c.normalized, c.kind]),
    [['/workunits/md-fabric', 'dir']],
  )
  assert.deepEqual(
    parsePaths('@workunits/md-fabric').map((c) => [c.normalized, c.kind]),
    [['/workunits/md-fabric', 'path']],
  )
  assert.deepEqual(
    parsePaths('@AGENTS.md').map((c) => [c.normalized, c.kind]),
    [['/AGENTS.md', 'file']],
  )
})

test('@ citation: bare single-segment word still root-anchors (path kind)', () => {
  assert.deepEqual(
    parsePaths('@handbooks').map((c) => [c.normalized, c.kind]),
    [['/handbooks', 'path']],
  )
  assert.deepEqual(
    parsePaths('@handbooks/').map((c) => [c.normalized, c.kind]),
    [['/handbooks', 'dir']],
  )
})

test('@ citation: quoted path-with-spaces keeps the anchor', () => {
  const result = parsePaths('see @"docs/design notes.md" please')
  assert.deepEqual(result.map((c) => c.normalized), ['see', '/docs/design notes.md', 'please'])
  assert.equal(result[1].raw, '@"docs/design notes.md"')
  assert.equal(result[1].kind, 'file')
})

test('@ citation: a lone @ marker is not a path', () => {
  assert.deepEqual(normalized('x @ y'), ['x', 'y'])
})

test('@ citation: email exclusion is untouched (inner @ is not a marker)', () => {
  assert.deepEqual(normalized('mail me at a@b.test'), ['mail', 'me', 'at'])
})

// --- CJK boundary tokenization ---
// Han chars and full-width punctuation act as token boundaries so English
// project names glued to surrounding CJK prose are extracted correctly.

test('CJK: splits English words from adjacent Han chars', () => {
  // `explorer任务，subagent-at` was one fused token; now three.
  assert.deepEqual(normalized('explorer任务，subagent-at'), ['explorer', '任务', 'subagent-at'])
})

test('CJK: Han segments are emitted as bare tokens', () => {
  assert.deepEqual(
    parsePaths('handbooks里的gates').map((c) => [c.normalized, c.kind]),
    [['handbooks', 'bare'], ['里的', 'bare'], ['gates', 'bare']],
  )
})

test('CJK: full-width brackets act as boundaries for path tokens', () => {
  const result = parsePaths('看下（dsh-plugin-dev/subagent-at）这个')
  assert.deepEqual(result.map((c) => c.normalized), ['看下', 'dsh-plugin-dev/subagent-at', '这个'])
  assert.equal(result[1].kind, 'path')
})

test('CJK: file paths adjacent to CJK prose are extracted', () => {
  assert.deepEqual(
    normalized('docs/a.md，还有 README.md。'),
    ['docs/a.md', '还有', 'README.md'],
  )
})

test('CJK: space-separated CJK prose tokenization is unchanged', () => {
  assert.deepEqual(
    normalized('打开 handbooks 里的 gates 文档'),
    ['打开', 'handbooks', '里的', 'gates', '文档'],
  )
})

test('CJK: pure-ASCII tokenization is unchanged (regression)', () => {
  assert.deepEqual(
    normalized('open handbooks/dsh-hooks'),
    ['open', 'handbooks/dsh-hooks'],
  )
  assert.deepEqual(normalized('see https://example.com/x'), ['see'])
})
