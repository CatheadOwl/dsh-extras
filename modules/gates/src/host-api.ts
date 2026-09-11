/**
 * Host API capability assertion: fail loud at activation when the host dsh
 * lacks an API this plugin consumes. Host packages are pre-stable 0.x, so
 * peer version ranges cannot carry a reliable floor (prerelease semver
 * ranges mislead, and profiles resolve peers through links that bypass
 * range checks) — probing the exact consumption point is the honest bound.
 */

import { Session } from '@deepseek-ai/dsh-session'

/**
 * Throw a named error when `Session#snapshotEvents` is absent.
 *
 * The turn-stopping driver reads the durable event log through it; the
 * getter it replaced (`session.events`) was removed upstream in 5660f44d29
 * (dsh 0.1.2-alpha.4 onward). Without this check the plugin instead dies
 * once per turn inside `agent/turn-stopping` as an opaque
 * "Cannot read properties of undefined (reading 'length')" turn/end error
 * while turn-end gates silently stop running.
 */
export function assertHostSessionApi(): void {
  if (typeof Session.prototype.snapshotEvents !== 'function') {
    throw new Error(
      'gates: host dsh is too old — Session#snapshotEvents is missing '
      + '(the `session.events` getter was removed upstream in 5660f44d29; '
      + 'this plugin needs a dsh release from 0.1.2-alpha.4 onward). '
      + 'See the compatibility note in CHANGELOG.md.',
    )
  }
}
