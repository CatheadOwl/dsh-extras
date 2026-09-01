import { useEffect, useState } from 'react'
import { Button, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

import type { PromptMiddlewareLocaleKey } from './locales.js'
import css from './PromptMiddlewareTab.module.css'

/** One row of the flat provider list as the host Remote reports it. */
export interface PromptMiddlewareProviderView {
  name: string
  kind?: string
  priority?: number
  timeoutMs?: number
  mode: 'always' | 'once'
  source: 'imperative' | 'declarative'
  enabled: boolean
}

/** Callbacks the plugin binds from the `promptMiddleware` Host Remote. */
export interface PromptMiddlewareTabInjected {
  list: () => Promise<PromptMiddlewareProviderView[]>
  setDisabled: (ids: string[]) => Promise<PromptMiddlewareProviderView[]>
}

export type PromptMiddlewareTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.promptMiddleware'>
  & InjectFace<PromptMiddlewareTabInjected>

type ViewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; providers: readonly PromptMiddlewareProviderView[] }

/**
 * The Settings → Plugins → Prompt Middleware tab: a flat list of every
 * registered provider with one switch per provider. The switch list is
 * persisted in the browser's localStorage and mirrored into host memory on
 * load and on every switch, so pre-step injection honors it immediately.
 */
export function PromptMiddlewareTab({ t, list, setDisabled }: PromptMiddlewareTabProps) {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [reload, setReload] = useState(0)
  const [pending, setPending] = useState<string | undefined>(undefined)

  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    void list().then(
      (providers) => {
        if (!current) return
        setState({ status: 'ready', providers })
      },
      (error: unknown) => {
        if (!current) return
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => { current = false }
  }, [reload, list])

  const toggle = async (provider: PromptMiddlewareProviderView): Promise<void> => {
    if (pending !== undefined || state.status !== 'ready') return
    setPending(provider.name)
    try {
      const next = state.providers.map(candidate =>
        candidate.name === provider.name ? { ...candidate, enabled: !candidate.enabled } : candidate,
      )
      const ids = next.filter(candidate => !candidate.enabled).map(candidate => candidate.name)
      const providers = await setDisabled(ids)
      setState({ status: 'ready', providers })
    } catch (error: unknown) {
      setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setPending(undefined)
    }
  }

  if (state.status === 'loading') {
    return <p className={css.status}>{t('loading')}</p>
  }

  if (state.status === 'error') {
    return (
      <div className={css.failure}>
        <p role="alert">{t('error')}</p>
        <code>{state.message}</code>
        <Button variant="outline" size="sm" icon={<IconRefreshOutline16 />} onClick={() => { setReload(value => value + 1) }}>
          {t('retry')}
        </Button>
      </div>
    )
  }

  return (
    <section className={css.section}>
      <div className={css.heading}>
        <div>
          <h3>{t('title')}</h3>
          <p className={css.description}>{t('description')}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<IconRefreshOutline16 />}
          aria-label={t('refresh')}
          title={t('refresh')}
          onClick={() => { setReload(value => value + 1) }}
        />
      </div>
      {state.providers.length === 0
        ? <p className={css.status}>{t('empty')}</p>
        : (
          <ul className={css.list}>
            {state.providers.map(provider => (
              <li key={provider.name} className={css.row}>
                <div className={css.copy}>
                  <div className={css.name}>{provider.name}</div>
                  <div className={css.meta}>{metaLabel(t, provider)}</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={provider.enabled}
                  aria-label={provider.name}
                  className={provider.enabled ? `${css.switch} ${css.switchOn}` : css.switch}
                  disabled={pending !== undefined}
                  onClick={() => { void toggle(provider) }}
                >
                  <span className={css.thumb} />
                </button>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}

function metaLabel(t: (key: PromptMiddlewareLocaleKey) => string, provider: PromptMiddlewareProviderView): string {
  const mode = provider.mode === 'always' ? t('modeAlways') : t('modeOnce')
  const source = provider.source === 'imperative' ? t('sourceImperative') : t('sourceDeclarative')
  const priority = provider.priority === undefined ? undefined : `${t('priority')} ${provider.priority}`
  const timeout = provider.timeoutMs === undefined ? undefined : `${t('timeout')} ${provider.timeoutMs}ms`
  return [source, mode, provider.kind, priority, timeout]
    .filter(segment => segment !== undefined && segment !== '')
    .join(' · ')
}
