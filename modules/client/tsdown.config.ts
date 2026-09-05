import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Host anchor: $DSH_REPO (machine env) > nested-repo default — same chain as
// scripts/host-tool.mjs. The clientBundle preset has no npm exit (upstream
// issue host-dev-surface-publication), so the host checkout is its only
// source and the import must be anchor-resolved, not hardcoded.
const hostRoot = process.env.DSH_REPO
  ? resolve(process.env.DSH_REPO)
  : resolve(import.meta.dirname, '../../../../deepseek-harness')
const { clientBundle } = await import(
  pathToFileURL(resolve(hostRoot, 'packages/client/tsdown.client.ts')).href
)

// The extras client anchor is ONE web-plugin row keyed on its own nested
// manifest (@catheadowl/dsh-extras-client), so it ships ONE client bundle:
// this aggregator composes every module's client half (gates settings tab,
// prompt-middleware settings tab) into a single factory. Built client-face
// only (DSH_BUILD_FACE=client + hostPhase), so the node halves stay with their
// modules' own tsc builds.
export default clientBundle('@catheadowl/dsh-extras-client', ['lib/index.js'], {
  hostPhase: true,
})
