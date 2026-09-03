/**
 * Deterministic attribution-isolation case: the single-agent equivalent of
 * the W10 parallel-isolation property (`test/composition.test.mjs`), run
 * through the real headless CLI with a repo-declared `gates.yml` module gate.
 *
 * The workspace pre-seeds TWO broken links (task-a.md and task-b.md), so a
 * full scan sees both. The scripted model `write`s only task-a.md (rewriting
 * the SAME broken content, not a fix), so the session change set is
 * `{ paths: ['task-a.md'] }`. At turn-stop the real doc-link check (shipped in
 * the md module of @catheadowl/dsh-extras, loaded here through the module-gate form)
 * full-scans, then filters to session-attributable violations: only task-a.md
 * survives, so every steer mentions task-a.md and never task-b.md — isolation
 * comes from the change set, not from visibility.
 *
 * Coverage boundary: this single-agent form proves spec test-baseline #7's
 * core property ("isolation from the session change set + attribution filter,
 * not from visibility"). True concurrency, the `opaque → true` fail-closed
 * direction, and the `target ∈ W` inbound-anchor clause are each covered by a
 * dedicated driver test in `test/composition.test.mjs` — not this case's job.
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { textStep, toolCallStep, userMessageTextExcludes, userMessageTextIncludes } from '@catheadowl/dsh-eval'

const here = dirname(fileURLToPath(import.meta.url))
// The doc-link gate surface lives in the md module of @catheadowl/dsh-extras; its
// `./markdown/gate-check` subpath exports the generic `check` for the module-gate form
// (the same `check` the plugin's registerGate definition loads, without the
// plugin-entry `registerGate` runtime deps). `moduleGate` resolves a relative
// `module` against the SESSION workspace cwd (this run's temp dir), so the
// path must be absolute. Forward slashes keep the YAML scalar unescaped.
const docLinkLib = join(here, '..', '..', '..', 'markdown', 'lib', 'gate-check.js').split(sep).join('/')

const BROKEN_A = '[broken](task-a-missing.md)\n'
const BROKEN_B = '[broken](task-b-missing.md)\n'

export default {
  id: 'gates-mock-attribution-filter-isolation',
  mode: 'mock',
  // Gate-interaction case: the package config disables the gates row by
  // default (non-git eval workspaces); an explicit empty list re-enables
  // everything — this case EXISTS to observe the gate's steer.
  disableRows: [],
  task: 'eval driver: write task-a.md, then finish — the repo doc-link gate must steer only that file',
  async prepare(workspace) {
    // A git repo so the doc-link scan (`git ls-files --cached --others`) has a
    // toplevel to resolve against; untracked files are listed via `--others`.
    spawnSync('git', ['init', '-q', workspace], { stdio: 'ignore' })
    writeFileSync(join(workspace, 'task-a.md'), BROKEN_A)
    writeFileSync(join(workspace, 'task-b.md'), BROKEN_B)
    // Repo-declared gate: the same `check(root, changes?)` surface the plugin's
    // registerGate definition loads, via the module-gate form. The module path
    // is absolute (above).
    writeFileSync(join(workspace, 'gates.yml'), [
      'gates:',
      '  - id: doc-link',
      `    module: "${docLinkLib}"`,
      '    description: internal markdown references resolve',
      '    rationale: broken links rot documentation silently',
      '',
    ].join('\n'))
    spawnSync('git', ['-C', workspace, 'add', '-A'], { stdio: 'ignore' })
  },
  script: {
    steps: [
      // Rewrite the SAME broken link, never a fix: otherwise the file becomes
      // link-clean, the scan finds nothing attributable, and no steer occurs.
      toolCallStep('write', { file_path: 'task-a.md', content: BROKEN_A }),
      textStep('a done'),
      // Default maxConsecutiveBlocks: 3 → three forced continuations, then the
      // budget degrades and the turn closes (5 model calls total).
      textStep('a steered'),
      textStep('a steered'),
      textStep('a steered'),
    ],
  },
  expect: [
    // Steered onto my own broken link (this also proves the steer arrived —
    // `Excludes` alone passes vacuously).
    userMessageTextIncludes('gates', 'task-a.md'),
    // Never steered onto the other file's broken link, though the full scan
    // sees it too.
    userMessageTextExcludes('gates', 'task-b.md'),
  ],
}
