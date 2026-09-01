import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

import * as gates from '../lib/index.js'

const testRoot = mkdtempSync(join(tmpdir(), 'gates-tool-surface-'))

test('gates_run exposes a typed, renderable, cancellable agent tool face', async () => {
  const ctx = new Context()
  const registered = []
  try {
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRuntime)
    const register = ctx.tools.register.bind(ctx.tools)
    ctx.tools.register = (tool) => {
      registered.push(tool)
      return register(tool)
    }
    await ctx.plugin(gates, {})

    assert.equal(registered.filter(tool => tool.name === 'gates_run').length, 1)
    const tool = registered.find(candidate => candidate.name === 'gates_run')
    assert.ok(tool.description.length > 0)
    assert.equal(tool.parameters.properties.gate.type, 'string')
    assert.equal(tool.parameters.properties.gate.description, 'Optional registered gate id to run a single gate; omit to run all.')
    assert.deepEqual(tool.output.schema, {})

    ctx.get('gates').register({
      id: 'tool-surface-demo',
      description: 'tool surface demo',
      rationale: 'exercise the manual tool path',
      on: ['manual'],
      level: 'advisory',
      check: async () => [{ reason: 'demo violation' }],
    })

    const agent = { session: { header: { cwd: testRoot } } }
    const result = await tool.execute({}, { agent, signal: new AbortController().signal })
    assert.equal(result.passed, false)
    assert.deepEqual(result.results.map(item => item.gateId), ['tool-surface-demo'])
    assert.equal(result.results[0].violations[0].reason, 'demo violation')

    const rendered = tool.output.render({}, result)
    assert.equal(rendered.length, 1)
    assert.equal(rendered[0].type, 'text')
    assert.deepEqual(JSON.parse(rendered[0].text), result)

    const controller = new AbortController()
    controller.abort()
    const cancelled = await tool.execute({}, { agent, signal: controller.signal })
    assert.equal(cancelled.passed, false)
    assert.equal(cancelled.results[0].status, 'skipped')
    assert.equal(cancelled.results[0].error, 'aborted before run')
  }
  finally {
    await ctx.dispose?.()
    rmSync(testRoot, { recursive: true, force: true })
  }
})
