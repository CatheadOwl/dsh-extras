/**
 * Keyless wiring smoke: a scripted model forces one turn whose user prompt
 * mentions a Markdown path. The real `agent/pre-step` → prompt-middleware →
 * any_routes breadcrumb provider chain must emit exactly ONE plugin-sourced
 * `user/message` carrying `relates:`. Proves the sessionId wiring, provider
 * registration, and injection land in the session log — not the cross-turn
 * `once` dedupe (the one-shot headless CLI runs a single turn).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { textStep } from '../../../../../eval/src/index.mjs'

export default {
  id: 'prompt-middleware-injection-smoke',
  mode: 'mock',
  task: 'read docs/guide.md and tell me what it is about',
  async prepare(workspace) {
    mkdirSync(join(workspace, 'docs'), { recursive: true })
    // The breadcrumb is keyed by the mentioned file's directory and carries
    // ancestor README descriptions only — the file's own description never
    // injects — so the fixture needs a described ancestor for an item to land.
    writeFileSync(join(workspace, 'docs', 'README.md'), '---\ndescription: Docs route\n---\n# Docs\n', 'utf8')
    writeFileSync(join(workspace, 'docs', 'guide.md'), '---\ndescription: Guide file\n---\n# Guide\n', 'utf8')
  },
  script: { steps: [textStep('done')] },
  async inspect(_workspace, { trace }) {
    if (trace === undefined) throw new Error('no session trace materialized')
    const injections = []
    for (const log of trace.sessions) {
      for (const event of log.events) {
        if (event.type !== 'user/message') continue
        if (event.data?.source?.plugin !== 'prompt-middleware') continue
        const text = (event.data?.content ?? [])
          .filter((block) => block?.type === 'text')
          .map((block) => block.text)
          .join('')
        if (text.includes('relates:')) injections.push(text)
      }
    }
    if (injections.length !== 1) {
      throw new Error(`expected exactly 1 prompt-middleware relates injection, got ${injections.length}`)
    }
    if (!injections[0].includes('breadcrumb-description')) {
      throw new Error(`injection missing breadcrumb-description: ${injections[0]}`)
    }
  },
  expect: [],
}
