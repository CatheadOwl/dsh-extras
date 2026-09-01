// Shared test helpers for the subagent-at suite.
// Tests exercise the BUILT `lib/` artifacts, never `src/`, so `node --test`
// runs against the same module graph the plugin loader imports.

import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/** Absolute path to the plugin root (`.../dsh-plugin-dev/subagent-at`). */
export const pluginRoot = fileURLToPath(new URL('..', import.meta.url))

/** Resolve a compiled ESM module under `lib/` to its file URL string. */
export function fromLib(rel) {
  return new URL(join('lib', rel) + '.js', new URL('file://' + pluginRoot.replace(/\\/g, '/') + '/')).href
}

/** A complete plugin Config (no schemastery round trip needed in tests). */
export function makeConfig(overrides = {}) {
  return {
    providerName: 'dsh-sdk-at',
    toolName: 'subagent_at',
    enableRunInBackground: true,
    command: 'node',
    args: [],
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    env: {},
    shutdownTimeoutMs: 1000,
    disposeEofGraceMs: 6000,
    disposeGraceMs: 3000,
    ...overrides,
  }
}

/**
 * Thin fake `ctx` for apply(): captures the registered provider, tool
 * definitions, and system-prompt sections; `subagents.start` records requests
 * and returns a scripted run (or rejects with `startError` to simulate a
 * provider-side start failure); `get('jobs')` returns an optional fake job
 * registry.
 */
export function makeCtx({ runResult, jobs, startError } = {}) {
  const fake = {
    providers: [],
    defs: [],
    sections: [],
    starts: [],
    jobs: jobs ?? { starts: [], start(spec) { fake.jobs.starts.push(spec); return 'subagent-1' } },
    get(name) { return name === 'jobs' ? fake.jobs : undefined },
    tools: { register(def) { fake.defs.push(def) } },
    systemPrompt: { section(section) { fake.sections.push(section) } },
    subagents: {
      registerProvider(provider) { fake.providers.push(provider); return () => {} },
      async start(name, request) {
        fake.starts.push({ name, request })
        if (startError !== undefined) throw startError
        return {
          id: 'run-1',
          localAgent: undefined,
          result: Promise.resolve(runResult ?? {
            output: [{ type: 'text', text: 'child-answer' }],
            stopReason: 'completed',
          }),
          dispose: async () => {},
        }
      },
    },
  }
  return fake
}

/** Tool execution context with a parent session workspace at `cwd`. */
export function makeExec(cwd = 'D:/parent-ws') {
  return {
    agent: { session: { header: { cwd } } },
    signal: new AbortController().signal,
  }
}
