/**
 * The extras package's single browser face: composes every module's client
 * half into one factory (the web plugin table has one row per package, so a
 * multi-module package ships one combined client bundle). Each half keeps its
 * own slots/locale registrations — composed here, owned there.
 *
 * @module @catheadowl/dsh-extras/modules/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'

import * as gatesClient from '../../../gates/src/client/index.js'
import * as promptClient from '../../../prompt/src/client/index.js'

export const inject = gatesClient.inject

export function apply(ctx: ClientContext): void {
  gatesClient.apply(ctx)
  promptClient.apply(ctx)
}
