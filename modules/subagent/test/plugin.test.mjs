// Plugin-surface tests for subagent-at: dual registration, native-wording
// alignment (drift guard against the host `tool-subagent` wording), and the
// per-call cwd slot semantics (resolution, passthrough, fail-loud paths).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fromLib, makeConfig, makeCtx, makeExec } from './helpers.mjs'

// SSOT copy of the native one-shot wording (host `tool-subagent`,
// providerWording(false) + the background-enabled suffix). These
// literals are the drift guard: if the host wording changes, both the plugin
// constants and these must be updated deliberately — never silently.
const NATIVE_BASE =
  'Delegate a self-contained task to a subagent (a separate agent that works in its own context) '
  + 'to offload focused, independent work — research, a scoped '
  + 'implementation, an analysis — so it does not consume this conversation\'s context. The subagent '
  + 'returns its result, not its intermediate steps. Give it a '
  + 'complete, standalone prompt: it does not see this conversation.'
const NATIVE_FOREGROUND_SUFFIX = ' This call waits for the subagent and returns its result.'
const NATIVE_BACKGROUND_SUFFIX =
  ' This call waits for the result by default. Set `run_in_background: true` to return a job id; collect with `job_output` and stop with `job_kill`.'
const NATIVE_PROMPT_DESCRIPTION =
  'The complete, self-contained task for the subagent. It does not share this '
  + 'conversation\'s context, so include everything it needs.'

test('apply registers exactly one provider and one tool', async () => {
  const { apply } = await import(fromLib('index'))
  const ctx = makeCtx()
  apply(ctx, makeConfig())
  assert.equal(ctx.providers.length, 1)
  assert.equal(ctx.defs.length, 1)
  assert.equal(ctx.providers[0].name, 'dsh-sdk-at')
  assert.equal(ctx.defs[0].name, 'subagent_at')
})

test('apply registers exactly one top-level system-prompt section for the tool', async () => {
  const { apply, SYSTEM_PROMPT_TEXT } = await import(fromLib('index'))
  const ctx = makeCtx()
  apply(ctx, makeConfig())
  assert.equal(ctx.sections.length, 1)
  const section = ctx.sections[0]
  assert.equal(section.name, 'tool:subagent_at')
  assert.equal(section.order, 116.6)
  assert.equal(section.text, SYSTEM_PROMPT_TEXT)
  assert.ok(section.text.length > 0, 'section text must be non-empty')
})

test('the system-prompt section leads with the directory-context value and routes same-workspace work away', async () => {
  const { SYSTEM_PROMPT_TEXT } = await import(fromLib('index'))
  // The section is the top-level mental model of the tool description's
  // directory-targeting hint: it must state WHY this tool exists (reusing the
  // target directory's context — its entry files), name the trigger condition
  // (different directory or project), and route same-workspace tasks to the
  // native tool.
  assert.match(SYSTEM_PROMPT_TEXT, /different directory or project/, 'must state the trigger condition')
  assert.match(SYSTEM_PROMPT_TEXT, /AGENTS\.md/, 'must name the entry-file consequence')
  assert.match(SYSTEM_PROMPT_TEXT, /`subagent`/, 'must route same-workspace tasks to the native tool')
  // The host section says "Use X in the background by default" — that is
  // continuable semantics and does NOT apply to this one-shot, foreground-by-
  // default tool. Copying it would contradict the actual behavior.
  assert.doesNotMatch(SYSTEM_PROMPT_TEXT, /background by default/, 'must not copy the host continuable wording')
})

test('provider advertises the out-of-process contract', async () => {
  const { apply } = await import(fromLib('index'))
  const ctx = makeCtx()
  apply(ctx, makeConfig())
  const provider = ctx.providers[0]
  assert.deepEqual(provider.capabilities, {
    agentOptions: false,
    outputSchema: false,
    depthLimit: false,
    toolFilter: false,
    persona: false,
  })
  assert.equal(provider.inheritsParentContext, false)
})

test('description = native wording verbatim + cwd hint only (drift guard)', async () => {
  const { apply, toolDescription } = await import(fromLib('index'))
  const ctx = makeCtx()
  apply(ctx, makeConfig())
  const def = ctx.defs[0]
  // Default config enables background, so the native one-shot background suffix
  // is in effect; the disabled variant is covered by its own test below.
  assert.equal(def.description, toolDescription(true))
  // Starts with the exact native sentence, ends with the exact native suffix;
  // everything between them is the directory-targeting hint.
  assert.ok(def.description.startsWith(NATIVE_BASE), 'native base must stay verbatim')
  assert.ok(def.description.endsWith(NATIVE_BACKGROUND_SUFFIX), 'native background suffix must stay verbatim')
  const hint = def.description.slice(NATIVE_BASE.length, def.description.length - NATIVE_BACKGROUND_SUFFIX.length)
  assert.ok(hint.includes('cwd'), 'hint must name the cwd slot')
  assert.ok(hint.includes('AGENTS.md'), 'hint must state the entry-file consequence')
  assert.ok(hint.includes('`subagent`'), 'hint must route same-workspace tasks to the native tool')
})

test('enableRunInBackground: false swaps to the native foreground suffix', async () => {
  const { apply, toolDescription } = await import(fromLib('index'))
  const ctx = makeCtx()
  apply(ctx, makeConfig({ enableRunInBackground: false }))
  const def = ctx.defs[0]
  assert.equal(def.description, toolDescription(false))
  assert.ok(def.description.endsWith(NATIVE_FOREGROUND_SUFFIX), 'native foreground suffix must stay verbatim')
})

test('parameter surface: native wording verbatim, added slots are cwd + run_in_background', async () => {
  const { apply } = await import(fromLib('index'))
  const ctx = makeCtx()
  apply(ctx, makeConfig())
  // defineTool normalizes the parameter map to a JSON-schema object.
  const schema = ctx.defs[0].parameters
  assert.equal(schema.type, 'object')
  assert.deepEqual(Object.keys(schema.properties).sort(), ['cwd', 'description', 'prompt', 'run_in_background'])
  assert.deepEqual([...schema.required].sort(), ['cwd', 'description', 'prompt'])
  assert.equal(schema.properties.description.description, 'A short (3-5 word) description of the delegated task, for display.')
  assert.equal(schema.properties.prompt.description, NATIVE_PROMPT_DESCRIPTION)
})

test('enableRunInBackground: false omits run_in_background and rejects a forced background call', async () => {
  const { apply } = await import(fromLib('index'))
  const ctx = makeCtx()
  apply(ctx, makeConfig({ enableRunInBackground: false }))
  const schema = ctx.defs[0].parameters
  assert.deepEqual(Object.keys(schema.properties).sort(), ['cwd', 'description', 'prompt'])
  const target = await mkdtemp(join(tmpdir(), 'subagent-at-target-'))
  try {
    await assert.rejects(
      ctx.defs[0].execute(
        { description: 'probe', prompt: 'do it', cwd: target, run_in_background: true },
        makeExec(),
      ),
      /run_in_background is disabled for this tool instance/,
    )
    assert.equal(ctx.starts.length, 0, 'no delegation may start after the refusal')
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('execute resolves a relative cwd against the parent session workspace', async () => {
  const { apply } = await import(fromLib('index'))
  const ctx = makeCtx()
  apply(ctx, makeConfig())
  const target = await mkdtemp(join(tmpdir(), 'subagent-at-target-'))
  try {
    const relative = './' + target.split(/[\\/]/).pop()
    // Parent workspace = the temp dir's parent, so the relative path hits it.
    const parentWs = target.replace(/[\\/][^\\/]+$/, '')
    const result = await ctx.defs[0].execute(
      { description: 'probe', prompt: 'do it', cwd: relative },
      makeExec(parentWs),
    )
    assert.equal(result, 'child-answer')
    assert.equal(ctx.starts.length, 1)
    assert.equal(ctx.starts[0].name, 'dsh-sdk-at')
    // The resolved value is absolute, hits the real target, and rides the
    // request as the plugin's extra field; label/prompt pass through.
    assert.equal(ctx.starts[0].request.cwd, target)
    assert.equal(ctx.starts[0].request.label, 'probe')
    assert.deepEqual(ctx.starts[0].request.prompt, [{ type: 'text', text: 'do it' }])
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('execute passes an absolute cwd through unchanged', async () => {
  const { apply } = await import(fromLib('index'))
  const ctx = makeCtx()
  apply(ctx, makeConfig())
  const target = await mkdtemp(join(tmpdir(), 'subagent-at-target-'))
  try {
    await ctx.defs[0].execute(
      { description: 'probe', prompt: 'do it', cwd: target },
      makeExec('D:/somewhere-else'),
    )
    assert.equal(ctx.starts[0].request.cwd, target)
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('execute rejects an empty cwd and a missing parent agent (fail loud)', async () => {
  const { apply } = await import(fromLib('index'))
  const ctx = makeCtx()
  apply(ctx, makeConfig())
  await assert.rejects(
    ctx.defs[0].execute({ description: 'probe', prompt: 'do it', cwd: '' }, makeExec()),
    /cwd must not be empty/,
  )
  await assert.rejects(
    ctx.defs[0].execute({ description: 'probe', prompt: 'do it', cwd: 'x' }, { signal: new AbortController().signal }),
    /requires a calling agent/,
  )
  assert.equal(ctx.starts.length, 0, 'no delegation may start after slot validation failed')
})

test('execute maps a non-completed stop reason to an error-carrying result', async () => {
  const { apply } = await import(fromLib('index'))
  const ctx = makeCtx({
    runResult: {
      output: [{ type: 'text', text: 'partial work' }],
      stopReason: 'max-tokens',
      diagnostic: 'child hit its ceiling',
    },
  })
  apply(ctx, makeConfig())
  const target = await mkdtemp(join(tmpdir(), 'subagent-at-target-'))
  try {
    await assert.rejects(
      ctx.defs[0].execute({ description: 'probe', prompt: 'do it', cwd: target }, makeExec()),
      (error) => {
        assert.match(error.message, /token limit/)
        assert.match(error.message, /partial work/)
        assert.match(error.message, /child hit its ceiling/)
        return true
      },
    )
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('provider.start rejects a request without a per-call cwd', async () => {
  const { apply } = await import(fromLib('index'))
  const ctx = makeCtx()
  apply(ctx, makeConfig())
  const provider = ctx.providers[0]
  await assert.rejects(
    Promise.resolve().then(() => provider.start({ prompt: [], parent: {}, signal: new AbortController().signal })),
    /no per-call cwd/,
  )
})

test('provider.start rejects an unusable per-call cwd before spawning', async () => {
  const { apply } = await import(fromLib('index'))
  const ctx = makeCtx()
  apply(ctx, makeConfig())
  const provider = ctx.providers[0]
  await assert.rejects(
    Promise.resolve().then(() => provider.start({
      prompt: [],
      parent: {},
      signal: new AbortController().signal,
      cwd: 'relative/not-absolute',
    })),
    /per-call cwd/,
  )
  await assert.rejects(
    Promise.resolve().then(() => provider.start({
      prompt: [],
      parent: {},
      signal: new AbortController().signal,
      cwd: join(tmpdir(), 'subagent-at-does-not-exist-' + Date.now()),
    })),
    /per-call cwd/,
  )
})

test('execute routes run_in_background: true through the jobs seam', async () => {
  const { apply } = await import(fromLib('index'))
  const ctx = makeCtx()
  apply(ctx, makeConfig())
  const target = await mkdtemp(join(tmpdir(), 'subagent-at-target-'))
  const exec = makeExec()
  try {
    const result = await ctx.defs[0].execute(
      { description: 'probe', prompt: 'do it', cwd: target, run_in_background: true },
      exec,
    )
    // The tool returns the registry-issued job id, never the child answer.
    assert.deepEqual(result, { kind: 'background', jobId: 'subagent-1' })
    assert.equal(ctx.jobs.starts.length, 1, 'exactly one background job was registered')
    const spec = ctx.jobs.starts[0]
    assert.equal(spec.kind, 'subagent')
    assert.equal(spec.label, 'probe')
    // The delegation is owned by the calling agent.
    assert.equal(spec.owner, exec.agent)
    // The child itself is NOT started yet: the job registry drives the starter.
    assert.equal(ctx.starts.length, 0, 'the child spawn happens inside the job run(), not the tool call')

    // Driving the registered job spawns the child with the resolved cwd and a
    // task-owned signal (distinct from the tool-call signal).
    const hooks = spec.run()
    assert.equal(ctx.starts.length, 1)
    assert.equal(ctx.starts[0].name, 'dsh-sdk-at')
    assert.equal(ctx.starts[0].request.cwd, target)
    assert.equal(ctx.starts[0].request.label, 'probe')
    assert.deepEqual(ctx.starts[0].request.prompt, [{ type: 'text', text: 'do it' }])
    // Cancellation aborts the task-owned controller, and the outcome settles
    // through the child result (completed here via the scripted run).
    const outcome = hooks.done
    hooks.cancel('user stopped it')
    assert.equal(ctx.starts[0].request.signal.aborted, true)
    assert.deepEqual(await outcome, { status: 'completed', output: 'child-answer' })
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('execute fails loud when run_in_background is requested without the jobs seam', async () => {
  const { apply } = await import(fromLib('index'))
  const ctx = makeCtx()
  // No jobs registry mounted: `get('jobs')` is undefined.
  ctx.jobs = undefined
  apply(ctx, makeConfig())
  const target = await mkdtemp(join(tmpdir(), 'subagent-at-target-'))
  try {
    await assert.rejects(
      ctx.defs[0].execute(
        { description: 'probe', prompt: 'do it', cwd: target, run_in_background: true },
        makeExec(),
      ),
      /background jobs unavailable/,
    )
    assert.equal(ctx.starts.length, 0, 'no delegation may start without the jobs seam')
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('execute keeps the foreground default when run_in_background is omitted', async () => {
  const { apply } = await import(fromLib('index'))
  const ctx = makeCtx()
  apply(ctx, makeConfig())
  const target = await mkdtemp(join(tmpdir(), 'subagent-at-target-'))
  try {
    const result = await ctx.defs[0].execute(
      { description: 'probe', prompt: 'do it', cwd: target },
      makeExec(),
    )
    assert.equal(result, 'child-answer')
    assert.equal(ctx.jobs.starts.length, 0, 'no background job for a foreground call')
    assert.equal(ctx.starts.length, 1)
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('background + unusable cwd: the tool returns the job id; the job later fails', async () => {
  const { apply } = await import(fromLib('index'))
  const missing = join(tmpdir(), 'subagent-at-does-not-exist-' + Date.now())
  // The provider-side per-start cwd validation rejects the missing directory
  // (assertUsableCwd); the child is only spawned when the job drives run().
  const ctx = makeCtx({
    startError: new Error('subagent-at: per-call cwd is not usable: ' + missing),
  })
  apply(ctx, makeConfig())
  const result = await ctx.defs[0].execute(
    { description: 'probe', prompt: 'do it', cwd: missing, run_in_background: true },
    makeExec(),
  )
  // Foreground would fail the tool call immediately; background defers the
  // spawn to the job, so the call succeeds with the job id and the failure
  // lands on the job outcome instead.
  assert.deepEqual(result, { kind: 'background', jobId: 'subagent-1' })
  assert.equal(ctx.starts.length, 0, 'the child is not spawned by the tool call itself')
  const hooks = ctx.jobs.starts[0].run()
  assert.equal(ctx.starts.length, 1, 'the job drives the child spawn')
  const outcome = await hooks.done
  assert.equal(outcome.status, 'failed')
  assert.match(outcome.detail, /per-call cwd is not usable/)
})

test('background: an aborted child settles the job as killed, not completed', async () => {
  const { apply } = await import(fromLib('index'))
  const ctx = makeCtx({
    // The child turn is aborted (e.g. job_kill cancels the task-owned signal
    // and the run settles as aborted): settleRun maps aborted -> killed.
    runResult: { output: [], stopReason: 'aborted' },
  })
  apply(ctx, makeConfig())
  const target = await mkdtemp(join(tmpdir(), 'subagent-at-target-'))
  try {
    const result = await ctx.defs[0].execute(
      { description: 'probe', prompt: 'do it', cwd: target, run_in_background: true },
      makeExec(),
    )
    assert.deepEqual(result, { kind: 'background', jobId: 'subagent-1' })
    const hooks = ctx.jobs.starts[0].run()
    const outcome = await hooks.done
    assert.deepEqual(outcome, { status: 'killed' })
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})
