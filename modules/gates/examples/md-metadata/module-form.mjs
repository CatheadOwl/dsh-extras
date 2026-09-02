/**
 * Example (frozen specimen): the `module:` form of a repo-level gate, in full.
 * Lineage: this is the former repo-root `scripts/md-metadata-lib.mjs` of the
 * dsh-extras dev repository — the data plane of its repo-level `gates.yml`
 * entry and the observation subject of the defer-bypass probe — moved here
 * verbatim after the check was uplifted to the plugin level
 * (`@catheadowl/dsh-extras` md module, `src/metadata-check.ts` +
 * `registerGate`, 2026-09-02). It does NOT evolve with the live data plane:
 * copy it, point `gates.yml` at it, but fix bugs in the module source.
 *
 * What it teaches: a repo-level gate module exports one generic surface —
 * `check(root, changes?)` returning `GateViolation[]` — where `changes` is
 * the optional session change set (`{ paths, opaque }`, stop trigger only;
 * the manual entry passes `undefined`). Filtering which written paths to
 * check (only `.md`) and how to read the frontmatter is this script's own
 * business. Swap the id when reusing: `md-metadata` is taken by the
 * plugin-level gate and a collision fails loud.
 *
 * md-metadata gate data plane: every Markdown file written in the current
 * session (the session change set) must declare a non-empty `description` in
 * its YAML frontmatter. Pure Node, no third-party dependencies.
 *
 * Known boundary: `changes.paths` only carries precise `write`/`edit` tool
 * calls; files produced by opaque tools (bash/subagents) or external editors
 * are invisible here (same limitation as the W2 dirty tracking). Those files
 * surface on their next precise write or a manual git review.
 */
import { readFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

const MANUAL_REMEDY = {
  kind: 'manual',
  guidance:
    'Add (or fill) a `description` field in the YAML frontmatter at the top of '
    + 'the file — e.g. `---\ndescription: <one-line summary>\n---`.',
}

/** POSIX form of a root-relative path; keeps reports deterministic across platforms. */
function posixRelative(root, target) {
  return relative(root, target).split(sep).join('/')
}

/**
 * Extract the leading YAML frontmatter body lines (between the opening `---`
 * and a closing `---` / `...`), or null when the file has no terminated
 * frontmatter block. Tolerates a UTF-8 BOM and CRLF line endings.
 */
function frontmatterBodyLines(source) {
  const text = source.replace(/^\uFEFF/, '')
  if (!/^---[ \t]*(?:\r?\n|$)/.test(text)) return null
  const lines = text.split(/\r?\n/)
  for (let index = 1; index < lines.length; index += 1) {
    if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[index])) return lines.slice(1, index)
  }
  return null
}

/**
 * Locate the top-level `description` key in a frontmatter body and classify
 * its value as present / empty, or missing. Returns the 1-based file line of
 * the key for location reporting. Handles inline scalars (plain and quoted),
 * unquoted YAML null spellings, and block scalars (`|` / `>` with optional
 * indentation and chomping indicators, in either order).
 */
function findDescription(bodyLines) {
  for (let index = 0; index < bodyLines.length; index += 1) {
    const line = bodyLines[index]
    const match = /^description[ \t]*:[ \t]*(.*)$/.exec(line)
    if (match === null) continue
    const fileLine = index + 2 // bodyLines[0] is file line 2 (line 1 is the opening `---`)
    const rest = match[1]

    if (/^[|>](?:[+-][0-9]*|[0-9]*[+-]?)[ \t]*$/.test(rest)) {
      const keyIndent = (line.match(/^[ \t]*/) ?? [''])[0].length
      let hasContent = false
      for (let cursor = index + 1; cursor < bodyLines.length; cursor += 1) {
        const next = bodyLines[cursor]
        if (/^[ \t]*$/.test(next)) continue
        hasContent = (next.match(/^[ \t]*/) ?? [''])[0].length > keyIndent
        break
      }
      return { status: hasContent ? 'present' : 'empty', line: fileLine }
    }

    if (rest.trim() === '') return { status: 'empty', line: fileLine }
    const trimmed = rest.trim()
    const isQuoted = (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2)
      || (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
    if (isQuoted) {
      return { status: trimmed.slice(1, -1).trim() === '' ? 'empty' : 'present', line: fileLine }
    }
    // Unquoted YAML null spellings carry no description.
    if (trimmed === 'null' || trimmed === 'Null' || trimmed === 'NULL' || trimmed === '~') {
      return { status: 'empty', line: fileLine }
    }
    return { status: 'present', line: fileLine }
  }
  return { status: 'missing', line: 1 }
}

function withinRoot(rootAbs, target) {
  const rootKey = rootAbs.toLowerCase()
  const targetKey = target.toLowerCase()
  return targetKey === rootKey || targetKey.startsWith(rootKey + sep)
}

/** Generic gate surface: check the session change set for `.md` files lacking a description. */
export function check(root, changes) {
  const violations = []
  if (changes == null || !Array.isArray(changes.paths)) return violations

  const rootAbs = resolve(root)
  for (const path of changes.paths) {
    if (typeof path !== 'string' || path === '' || !path.toLowerCase().endsWith('.md')) continue
    const abs = resolve(root, path)
    if (!withinRoot(rootAbs, abs)) continue

    let source
    try {
      source = readFileSync(abs, 'utf8')
    } catch {
      continue // file no longer exists this turn (renamed/deleted); not this gate's concern
    }

    const body = frontmatterBodyLines(source)
    if (body === null) {
      violations.push({
        file: posixRelative(root, abs),
        line: 1,
        reason: 'missing YAML frontmatter with a description field',
        remedy: MANUAL_REMEDY,
      })
      continue
    }

    const found = findDescription(body)
    if (found.status === 'missing') {
      violations.push({
        file: posixRelative(root, abs),
        line: 1,
        reason: 'frontmatter has no description field',
        remedy: MANUAL_REMEDY,
      })
    } else if (found.status === 'empty') {
      violations.push({
        file: posixRelative(root, abs),
        line: found.line,
        reason: 'frontmatter description field is empty',
        remedy: MANUAL_REMEDY,
      })
    }
  }
  return violations
}
