/**
 * Placeholder node half for the client aggregator module. Never loaded as a
 * plugin (the extras composition rows point at the real modules' entries);
 * exists only so the shared client preset has a nominal lib entry. The
 * client-face build never emits it.
 *
 * @module @catheadowl/dsh-extras/modules/client
 */
export const name = 'extras-client-aggregator'

export const inject: string[] = []

export function apply(): void {}
