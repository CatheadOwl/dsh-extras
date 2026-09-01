/**
 * Shared md-rename eval fixture: seed a real git repo inside an eval workspace
 * so `md_rename`'s git data plane (`git mv` + `git grep -l`) has a tracked
 * tree to operate on. Files are staged (`git add -A`), not merely created,
 * because `applyRenamePlan` runs `git mv` and in-link localization runs
 * `git grep` — both require the source to be tracked. Mirrors the unit-test
 * fixtures in `test/plugin.test.mjs` and `md-links/test/rename.test.mjs`.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Write `files` (workspace-relative path → content), then `git init` + `git add -A`. */
export function seedRepo(workspace, files) {
  for (const [rel, source] of Object.entries(files)) {
    const abs = join(workspace, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, source)
  }
  execFileSync('git', ['init', '-q', workspace], { stdio: 'ignore' })
  execFileSync('git', ['-C', workspace, 'add', '-A'], { stdio: 'ignore' })
}

/** Whether the workspace-relative path exists. */
export function pathExists(workspace, rel) {
  return existsSync(join(workspace, rel))
}

/** Read a workspace-relative file as UTF-8 text. */
export function readText(workspace, rel) {
  return readFileSync(join(workspace, rel), 'utf8')
}
