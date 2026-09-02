import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import * as rootFace from '../lib/index.js'
import { check as checkDocsNav } from '../scripts/verify-docs-nav.mjs'
import { check as checkPackageFace } from '../../../scripts/verify-package-face.mjs'
import { check as checkRegisterDocs } from '../scripts/register-reference.mjs'

const packageRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const extrasRoot = resolve(packageRoot, '../..')

test('root entry exports only the dsh loader contract', () => {
  assert.deepEqual([...Object.keys(rootFace).sort()], ['Config', 'apply', 'inject', 'name'])
})

test('package face gate passes for the whole extras package', async () => {
  assert.deepEqual(await checkPackageFace(extrasRoot), [])
})

test('register-face generated docs gate passes for the current package', async () => {
  assert.deepEqual(await checkRegisterDocs(packageRoot), [])
})

test('docs navigation gate passes for the current package', () => {
  assert.deepEqual(checkDocsNav(packageRoot), [])
})

