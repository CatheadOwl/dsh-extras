/**
 * md module: the Markdown toolchain row of `@catheadowl/dsh-extras` — one
 * fiber registering all three model-facing surfaces:
 *
 * - the `md_rename` tool (move + deterministic all-or-nothing link rewrite),
 *   a thin wrapper over the in-module `./links` pure lib (plan/apply:
 *   `planRename` / `applyRenamePlan`; conflict → report, never guess);
 * - the `doc-link` gate (Markdown link integrity at turn-stop and manual runs),
 *   soft-registered through `registerGate` (gates absent → loads, registers
 *   nothing) with the data plane and attribution policy in `./gate-check`;
 * - the `md-metadata` gate (session-written Markdown must declare a non-empty
 *   frontmatter `description`; defer + subagent fixer), data plane in
 *   `./metadata-check` — the former repo-level `scripts/md-metadata-lib.mjs`.
 *
 * The surfaces share one fiber on purpose (single-copy rule): the tool and the
 * gates must agree on the same Markdown algorithms at the same version —
 * vendoring copies would drift and a drift is a false report.
 *
 * @module @catheadowl/dsh-extras/modules/md
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { registerGate } from '@catheadowl/dsh-extras/register'
import type { GateDefinition, GateViolation } from '@catheadowl/dsh-extras/register'
import { REASON_NO_RENAME_EVIDENCE, applyRenamePlan, planRename } from './links/index.js'
import type { RenameConflict, RenameSkip } from './links/index.js'

import { check as checkDocLink } from './gate-check.js'
import { check as checkMdMetadata } from './metadata-check.js'

export const name = 'md'

export const inject = ['tools']

/** Loader contract: the md row takes no user-facing options today. */
export const Config = z.object({})

/** Calling session's workspace (`SessionHeader.cwd`); non-agent callers fall back to the process cwd. */
function sessionWorkspace(exec: ToolExecution): string {
  return exec.agent?.session.header.cwd ?? '.'
}

/**
 * D1 remedy exits, attached when git cannot witness the completed rename
 * (the lib emits the structured reason; the wording lives here). D3: the
 * consistency check in exit ② is agent-side guidance — the tool never
 * restores or diffs content itself.
 */
const NO_EVIDENCE_REMEDY = [
  'Confirm the real old path: git status and git log --follow -- <newPath> show where the file actually came from.',
  'If old exists in HEAD and new was not edited since the move: restore first — verify the new content matches HEAD (e.g. git cat-file -p HEAD:<oldPath>), then git checkout HEAD -- <oldPath>, remove newPath, and re-run md_rename with the same pair.',
  'If old was never tracked: references to it were already broken before the move — that is the gate-side detection surface (broken links), not this tool.',
]

function conflictView(c: RenameConflict): { file: string; line: number; url: string; reason: string } {
  return { file: c.file, line: c.line, url: c.url, reason: c.reason }
}

function skipView(s: RenameSkip): { file: string; line: number; url: string; reason: string } {
  return { file: s.file, line: s.line, url: s.url, reason: s.reason }
}

/**
 * Local JsonValue alias: upstream `@deepseek-ai/dsh-tools` 自 9135a13a8b 起不再 re-export
 * `JsonValue`（只从 `@deepseek-ai/dsh-util-values` 内部导入）；结构与其保持一致，
 * 避免为单个类型引入新 peer 依赖。
 */
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** Lossless-JSON projection for the json-schema tool output. */
function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

const DOC_LINK_GATE: Omit<GateDefinition, 'check'> = {
  id: 'doc-link',
  description: 'Internal Markdown references (links, images, definitions) must resolve to an existing target and anchor.',
  rationale:
    'Broken links and anchors rot documentation silently: a reader follows the reference to nothing, '
    + 'and the damage compounds as more notes link to the dead target. The check is read-only and the '
    + 'filesystem is authoritative — repairing the reference in place (or creating/moving the target it '
    + 'points to) is always safe. External targets (//, /, scheme) and fragments onto non-Markdown '
    + 'targets are out of scope and never flagged.',
  on: ['stop', 'manual'],
  level: 'blocking',
  // Incremental shortcut: only dirty .md paths can change this gate's result.
  relevantPath: (path) => path.toLowerCase().endsWith('.md'),
}

/** The fixer prompt's house rules for writing a `description` (semantic, not mechanical). */
const MD_METADATA_FIXER_PROMPT = [
  'You are repairing a workspace quality-gate failure. Each file listed',
  'below must declare a non-empty `description` in its YAML frontmatter.',
  'If a file has no frontmatter block, create one at the top of the file.',
  'For each file: read it, then add (or fill) a `description` field — one',
  'sentence acting as the file\'s business card, written by these house',
  'rules:',
  '- Match the language of the document body.',
  '- Keep it skeletal and stable: one short sentence, never more than two',
  '  rendered lines.',
  '- Use precise domain/code vocabulary (entity names, symbols, concepts)',
  '  to state the subject exactly — no generic filler.',
  '- Do not restate the filename; say what the file contains or who it is for.',
  '- At most 4 enumerated items; beyond that, generalize to a precise',
  '  category term (a domain word, not a filler like "misc" or "stuff").',
  'Then sanity-check: without reading the body, can a reader tell what',
  'this document is about, and will the summary stay accurate as the',
  'body grows? Do not create new files and do not change anything else.',
].join('\n')

const MD_METADATA_GATE: Omit<GateDefinition, 'check'> = {
  id: 'md-metadata',
  description: 'Markdown files written this session must declare a non-empty `description` in their YAML frontmatter.',
  rationale:
    'The frontmatter `description` is a note\'s discovery and classification key; a note without one is hard '
    + 'to find or categorize later. The gate rechecks only files written since the last clean pass, so it stays '
    + 'cheap and targeted at new docs. A vague or filename-restating description is nearly as bad as a missing '
    + 'one, so the fixer writes each one following the house rules embedded in its prompt instead of improvising. '
    + 'A good description is a semantic judgment rather than a mechanical extraction, so repair is delegated to a '
    + 'subagent: it inherits the session context, reads each file, and writes the description outside the main '
    + 'turn. The repair is one additive frontmatter field and the fixer changes nothing else, so it is low-risk. '
    + 'A defer-level failure never blocks the session: the fixer is dispatched, the turn closes immediately, and '
    + 'the gate rescans at the next turn-stop until it passes. Known boundary: files produced through opaque '
    + 'tools (bash/subagents) or external editors are invisible to the session change set; they surface only '
    + 'when later written directly by the session or caught in a manual git review.',
  on: ['stop', 'manual'],
  level: 'defer',
  // Incremental shortcut: only dirty .md paths can change this gate's result.
  relevantPath: (path) => path.toLowerCase().endsWith('.md'),
  fixer: { kind: 'subagent', prompt: MD_METADATA_FIXER_PROMPT },
}

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'md_rename',
    description:
      'Move a file or directory to a new path and rewrite every internal Markdown reference (links, images, definitions) so all links keep resolving. Deterministic and all-or-nothing: it plans the full edit set — in-link rewrite plus out-link rebase — before writing anything, then refuses the whole move on any hard conflict (newPath already exists, oldPath missing, or a path outside the repository). If the move already happened — oldPath missing, newPath present, and git can witness the rename (a staged R record, a D record with the shifted file on disk, or a HEAD entry) — the same call repairs the links only (status "repaired", no move performed); without that evidence it refuses with a remedy hint instead of guessing. Prefer this tool over manually editing links for any Markdown move — including one you merely discover (a tracked path gone from disk, its content reappearing elsewhere): pass the (oldPath, newPath) pair and let it rewrite in-links and rebase the moved file\'s own out-links in one deterministic pass. The tool never restores or verifies already-moved content itself. References it cannot rewrite deterministically (already-broken links, external/absolute targets, and rebased destinations with unrepresentable characters) are skipped and reported, never guessed. oldPath and newPath are workspace-root-relative.',
    parameters: {
      oldPath: {
        type: 'string',
        required: true,
        description: 'Workspace-root-relative path of the file or directory to move, e.g. docs/old.md or docs/old-dir.',
      },
      newPath: {
        type: 'string',
        required: true,
        description: 'Workspace-root-relative destination path, e.g. notes/new.md or notes/new-dir. Must not already exist (unless the move already happened and git can witness it — then the call repairs links only).',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const root = sessionWorkspace(exec)
      const { certain, plan } = planRename(root, args.oldPath, args.newPath)
      if (!certain) {
        const conflicts = plan.conflicts.map(conflictView)
        return toJsonValue({
          status: 'conflict',
          conflicts,
          skips: plan.skips.map(skipView),
          ...(conflicts.some(c => c.reason === REASON_NO_RENAME_EVIDENCE) ? { remedy: NO_EVIDENCE_REMEDY } : {}),
        })
      }
      const result = applyRenamePlan(plan)
      return toJsonValue({
        status: result.moved ? 'moved' : 'repaired',
        oldPath: args.oldPath,
        newPath: args.newPath,
        edited: result.edited,
        skips: plan.skips.map(skipView),
      })
    },
  }))

  registerGate(ctx, {
    ...DOC_LINK_GATE,
    check: async (root, changes): Promise<GateViolation[]> => checkDocLink(root, changes),
  })

  registerGate(ctx, {
    ...MD_METADATA_GATE,
    check: async (root, changes): Promise<GateViolation[]> => checkMdMetadata(root, changes),
  })
}
