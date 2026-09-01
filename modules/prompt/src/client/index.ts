import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings contract SlotMap merge without re-declaring it.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
// Type-only: pulls the `ctx.slots` Context augmentation (the registry service
// is provided by the renderer plugin).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

import { PromptMiddlewareTab } from './PromptMiddlewareTab.js'
import type { PromptMiddlewareTabInjected } from './PromptMiddlewareTab.js'
import { en, zh, type PromptMiddlewareLocaleKey } from './locales.js'
import { loadDisabledProviderNames, saveDisabledProviderNames } from './storage.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.promptMiddleware': PromptMiddlewareLocaleKey
  }
}

const NS = 'settings.promptMiddleware'

export const inject = ['slots', 'locale', 'connection']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'prompt-middleware: dictionaries')

  // `connection` is in `inject` so the fiber waits for the wire-root connection
  // plugin, but read via strict `ctx.get` + cast: the browser face declares no
  // `Context.connection` augmentation (only the host half does).
  const connection = ctx.get('connection') as ConnectionHandle
  const call = async <T,>(method: string, args: Record<string, unknown> = {}): Promise<T> => {
    const result = await connection.rpc.call('/api', `promptMiddleware/${method}`, { args })
    if (!result.ok) {
      throw new Error(`${result.error.code}: ${result.error.message}`)
    }
    return result.value as T
  }
  const injected = (): PromptMiddlewareTabInjected => ({
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

  ctx.effect(() => ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'prompt-middleware',
    order: 6,
    label: () => ctx.locale.bind(NS)('tab'),
    locale: NS,
    inject: injected,
  }, PromptMiddlewareTab)), 'prompt-middleware: settings tab')
}
