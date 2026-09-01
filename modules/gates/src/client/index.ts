import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings contract SlotMap merge without re-declaring it.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
// Type-only: pulls the `ctx.slots` Context augmentation (the registry service
// is provided by the renderer plugin).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the GlobalStandardProps merges that type the root-scope
// `useSessions`/`useWorkspaces` standard hooks this tab consumes.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'

import { GatesTab } from './GatesTab.js'
import type { GatesTabInjected } from './GatesTab.js'
import { en, zh, type GatesLocaleKey } from './locales.js'
import { loadDisabledTriggers, saveDisabledTriggers } from './storage.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.gates': GatesLocaleKey
  }
}

const NS = 'settings.gates'

export const inject = ['slots', 'locale', 'connection']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'gates: dictionaries')

  // `connection` is in `inject` so the fiber waits for the wire-root connection
  // plugin, but read via strict `ctx.get` + cast: the browser face declares no
  // `Context.connection` augmentation (only the host half does).
  const connection = ctx.get('connection') as ConnectionHandle
  const call = async <T,>(method: string, args: Record<string, unknown> = {}): Promise<T> => {
    const result = await connection.rpc.call('/api', `gates/${method}`, { args })
    if (!result.ok) {
      throw new Error(`${result.error.code}: ${result.error.message}`)
    }
    return result.value as T
  }
  // Typert wire args key by the SOURCE-LEVEL PARAMETER NAME (`request`); an
  // absent workspace omits the wire arg entirely (server-cwd fallback).
  const injected = (): GatesTabInjected => ({
    // Mirror the browser's persisted switches into host memory first, so a
    // restarted host enforces the same set (and a cleared list re-enables
    // everything) before the list is read.
    list: async (workspace) => {
      const { stop, manual } = loadDisabledTriggers()
      await call('setDisabled', { request: { stop, manual, ...(workspace === undefined ? {} : { workspace }) } })
        .catch(() => undefined)
      return call('list', workspace === undefined ? {} : { request: { workspace } })
    },
    setDisabled: async (request) => {
      saveDisabledTriggers({ stop: request.stop, manual: request.manual })
      return call('setDisabled', { request })
    },
  })

  ctx.effect(() => ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'gates',
    order: 4,
    label: () => ctx.locale.bind(NS)('tab'),
    locale: NS,
    inject: injected,
  }, GatesTab)), 'gates: settings tab')
}
