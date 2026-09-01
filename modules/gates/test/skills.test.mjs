import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fromLib } from './helpers.mjs'

// Mock-apply skill test: capture what `registerGatesConfigGuideSkill` registers
// through a fake `ctx.inject` that hands back a `skills` registry (same pattern
// as coggit's shape-and-views tests; the inject callback is the soft-dependency
// seam the plugin uses, so the fake drives exactly the code path apply uses).
function captureSkillRegistration() {
  const registered = []
  const ctx = {
    inject(deps, callback) {
      if (!deps.includes('skills')) throw new Error(`unexpected inject deps: ${deps.join(',')}`)
      callback({ skills: { register(skill) { registered.push(skill) } } })
    },
  }
  return { ctx, registered }
}

test('registerGatesConfigGuideSkill registers one user-only gates-config-guide skill', async () => {
  const { registerGatesConfigGuideSkill, GATES_CONFIG_GUIDE_SKILL_NAME } = await import(fromLib('skills'))
  const { ctx, registered } = captureSkillRegistration()
  registerGatesConfigGuideSkill(ctx)
  assert.equal(registered.length, 1)
  const skill = registered[0]
  assert.equal(skill.name, GATES_CONFIG_GUIDE_SKILL_NAME)
  assert.equal(skill.name, 'gates-config-guide')
  // Public skill-name grammar enforced by the registry (isSkillName).
  assert.match(skill.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  // The inverse of coggit's model-only handbooks: human gesture only.
  assert.deepEqual(skill.invocation, { modelInvocable: false, userInvocable: true })
  assert.equal(skill.source, 'custom')
  assert.ok(skill.description.length > 0)
  assert.ok(skill.whenToUse !== undefined && skill.whenToUse.length > 0)
})

test('config-guide body covers creating, understanding, and writing gates.yml', async () => {
  const { registerGatesConfigGuideSkill } = await import(fromLib('skills'))
  const { ctx, registered } = captureSkillRegistration()
  registerGatesConfigGuideSkill(ctx)
  const content = registered[0].content
  // The three requested surfaces: create / understand / write.
  for (const needle of [
    'gates.yml',
    'module',
    'command',
    'rationale',
    'level',
    'timeoutMs',
    'relevant',
    'gates-config',
    'gates_run',
    '/gates',
    'mtime',
  ]) {
    assert.ok(content.includes(needle), `skill body must mention ${needle}`)
  }
})

test('registerGatesConfigGuideSkill declares skills as a soft dependency via ctx.inject', async () => {
  const { registerGatesConfigGuideSkill } = await import(fromLib('skills'))
  // The registration reaches `ctx.skills` only through the inject callback —
  // never by direct property access (a direct `ctx.skills` read would make the
  // fake throw). So a profile without dsh-skill never runs the callback and
  // gates stays fully functional minus the skill. This test pins that
  // declaration shape, not the absence of a registration (the fake has no
  // register channel to assert against).
  const deps = []
  const ctx = { inject(injectDeps) { deps.push(injectDeps) } }
  registerGatesConfigGuideSkill(ctx)
  assert.deepEqual(deps, [['skills']])
})
