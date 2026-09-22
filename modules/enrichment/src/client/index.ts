import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the plugins-page config slot contract (SlotMap merge)
// without re-declaring it.
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
// Type-only: pulls the `ctx.slots` Context augmentation (the registry service
// is provided by the renderer plugin).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

import { EnrichmentTab } from './EnrichmentTab.js'
import type { EnrichmentTabInjected } from './EnrichmentTab.js'
import { en, zh, type EnrichmentLocaleKey } from './locales.js'
import { loadDisabledProviderNames, saveDisabledProviderNames } from './storage.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'plugins.enrichment': EnrichmentLocaleKey
  }
}

const NS = 'plugins.enrichment'

export const inject = ['slots', 'locale', 'connection']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'enrichment: dictionaries')

  // `connection` is in `inject` so the fiber waits for the wire-root connection
  // plugin, but read via strict `ctx.get` + cast: the browser face declares no
  // `Context.connection` augmentation (only the host half does).
  const connection = ctx.get('connection') as ConnectionHandle
  const call = async <T,>(method: string, args: Record<string, unknown> = {}): Promise<T> => {
    const result = await connection.rpc.call('/api', `enrichment/${method}`, { args })
    if (!result.ok) {
      throw new Error(`${result.error.code}: ${result.error.message}`)
    }
    return result.value as T
  }
  const injected = (): EnrichmentTabInjected => ({
    // Mirror the browser's persisted switches into host memory first, so a
    // restarted host enforces the same set (and a cleared list re-enables
    // everything) before the list is read.
    list: async () => {
      const ids = loadDisabledProviderNames()
      await call('setDisabled', { request: { ids } }).catch(() => undefined)
      return call('list')
    },
    setDisabled: async (ids) => {
      saveDisabledProviderNames(ids)
      return call('setDisabled', { request: { ids } })
    },
  })

  ctx.effect(() => ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
    name: 'plugins.row.config',
    key: '@catheadowl/dsh-extras#enrichment',
    locale: NS,
    inject: injected,
  }, EnrichmentTab)), 'enrichment: row config page')
}
