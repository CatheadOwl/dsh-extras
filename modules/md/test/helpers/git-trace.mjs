import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'

/**
 * F4 spawn counting: real git + a GIT_TRACE file target (spec git-data-plane
 * §4, "真实 git + 计数 wrapper"). Every spawned git process appends exactly
 * one `trace: built-in: git <argv>` line, and global options like `-C` are
 * consumed before the trace — so the subcommand is simply the first token.
 * Counts are read back from the file, no fake-binary PATH games (a spawnable
 * fake git cannot be scripted on Windows) and no `.git-moved` side-effect
 * tricks.
 */

/** Absolute forward-slash trace target — the form git accepts on POSIX and Windows. */
export function gitTraceTarget(testDir) {
  return resolve(testDir, 'git-spawn-trace.log').split(sep).join('/')
}

/**
 * Arm GIT_TRACE for every later git spawn in this process (lib-internal spawns
 * inherit the environment) and zero the counter. Arm AFTER fixture setup so
 * setup spawns stay outside the measured window.
 */
export function armGitTrace(target) {
  process.env.GIT_TRACE = target
  writeFileSync(target, '')
}

/** Disarm and let later git spawns (other fixtures) run untraced. */
export function disarmGitTrace() {
  delete process.env.GIT_TRACE
}

/** Spawn counts keyed by git subcommand, from the `built-in:` trace lines alone. */
export function gitSpawnCounts(target) {
  const content = existsSync(target) ? readFileSync(target, 'utf8') : ''
  const counts = new Map()
  for (const line of content.split('\n')) {
    const hit = line.match(/trace: built-in: git (\S+)/)
    if (!hit) continue
    counts.set(hit[1], (counts.get(hit[1]) ?? 0) + 1)
  }
  return counts
}

/** Total spawned subprocesses across all subcommands. */
export function totalSpawns(counts) {
  let total = 0
  for (const n of counts.values()) total += n
  return total
}
