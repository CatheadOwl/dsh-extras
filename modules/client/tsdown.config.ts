import { clientBundle } from '../../../../deepseek-harness/packages/client/tsdown.client.ts'

// The extras client anchor is ONE web-plugin row keyed on its own nested
// manifest (@catheadowl/dsh-extras-client), so it ships ONE client bundle:
// this aggregator composes every module's client half (gates settings tab,
// prompt-middleware settings tab) into a single factory. Built client-face
// only (DSH_BUILD_FACE=client + hostPhase), so the node halves stay with their
// modules' own tsc builds.
export default clientBundle('@catheadowl/dsh-extras-client', ['lib/index.js'], {
  hostPhase: true,
})
