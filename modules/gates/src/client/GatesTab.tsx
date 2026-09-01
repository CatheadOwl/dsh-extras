import { useEffect, useState } from 'react'
import { Button, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

import type { GatesLocaleKey } from './locales.js'
import { resolveWorkspacePath } from './workspace-resolve.js'
import css from './GatesTab.module.css'

export type GatesGateLevel = 'blocking' | 'advisory' | 'defer'
export type GatesGateTrigger = 'stop' | 'manual'

/** One row of the flat gate list as the host Remote reports it. */
export interface GatesGateView {
  id: string
  description: string
  level: GatesGateLevel
  on: GatesGateTrigger[]
  source: 'plugin' | 'project'
  /** Per-trigger user-enabled state: turn-stop (fixed) and manual (agent-chosen). */
  stopEnabled: boolean
  manualEnabled: boolean
}

export interface GatesSetDisabledRequest {
  stop: string[]
  manual: string[]
  workspace?: string
}

/** Callbacks the plugin binds from the `gates` Host Remote. */
export interface GatesTabInjected {
  list: (workspace: string | undefined) => Promise<GatesGateView[]>
  setDisabled: (request: GatesSetDisabledRequest) => Promise<GatesGateView[]>
}

export type GatesTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.gates'>
  & InjectFace<GatesTabInjected>

type ViewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; gates: readonly GatesGateView[] }

/**
 * The Settings → Plugins → Gates tab: a flat list of every gate in the
 * current workspace with two switches per gate — turn-stop (fixed, mandatory)
 * and manual (agent-chosen). The switch lists are persisted in the browser's
 * localStorage and mirrored into host memory on load and on every switch, so
 * turn-stop and /gates honor them immediately.
 */
export function GatesTab({ t, useSessions, useWorkspaces, list, setDisabled }: GatesTabProps) {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [reload, setReload] = useState(0)
  const [pending, setPending] = useState<string | undefined>(undefined)

  const sessions = useSessions(listState => listState)
  const workspacePath = useWorkspaces(workspaceState => resolveWorkspacePath(workspaceState, sessions))

  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    void list(workspacePath).then(
      (gates) => {
        if (!current) return
        setState({ status: 'ready', gates })
      },
      (error: unknown) => {
        if (!current) return
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => { current = false }
  }, [reload, workspacePath, list])

  const toggle = async (gate: GatesGateView, trigger: GatesGateTrigger): Promise<void> => {
    if (pending !== undefined || state.status !== 'ready') return
    setPending(`${gate.id}:${trigger}`)
    try {
      const next = state.gates.map(candidate => {
        if (candidate.id !== gate.id) return candidate
        return trigger === 'stop'
          ? { ...candidate, stopEnabled: !candidate.stopEnabled }
          : { ...candidate, manualEnabled: !candidate.manualEnabled }
      })
      const stop = next.filter(candidate => !candidate.stopEnabled).map(candidate => candidate.id)
      const manual = next.filter(candidate => !candidate.manualEnabled).map(candidate => candidate.id)
      const gates = await setDisabled({ stop, manual, workspace: workspacePath })
      setState({ status: 'ready', gates })
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
      {state.gates.length === 0
        ? <p className={css.status}>{t('empty')}</p>
        : (
          <ul className={css.list}>
            {state.gates.map(gate => (
              <li key={gate.id} className={css.row}>
                <div className={css.copy}>
                  <div className={css.name}>{gate.id}</div>
                  <div className={css.description}>{gate.description}</div>
                  <div className={css.meta}>{metaLabel(t, gate)}</div>
                </div>
                <div className={css.switches}>
                  {gate.on.map(trigger => (
                    <div key={trigger} className={css.switchGroup}>
                      <span className={css.switchCaption}>{triggerLabel(t, trigger)}</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={trigger === 'stop' ? gate.stopEnabled : gate.manualEnabled}
                        aria-label={`${triggerLabel(t, trigger)}: ${gate.id}`}
                        className={
                          (trigger === 'stop' ? gate.stopEnabled : gate.manualEnabled)
                            ? `${css.switch} ${css.switchOn}`
                            : css.switch
                        }
                        disabled={pending !== undefined}
                        onClick={() => { void toggle(gate, trigger) }}
                      >
                        <span className={css.thumb} />
                      </button>
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}

function triggerLabel(t: (key: GatesLocaleKey) => string, trigger: GatesGateTrigger): string {
  return trigger === 'stop' ? t('triggerStop') : t('triggerManual')
}

function metaLabel(t: (key: GatesLocaleKey) => string, gate: GatesGateView): string {
  const level = gate.level === 'blocking'
    ? t('levelBlocking')
    : gate.level === 'advisory' ? t('levelAdvisory') : t('levelDefer')
  const triggers = gate.on
    .map(trigger => trigger === 'stop' ? t('triggerStop') : t('triggerManual'))
    .join(' + ')
  const source = gate.source === 'plugin' ? t('sourcePlugin') : t('sourceProject')
  return [level, triggers, source].filter(segment => segment !== '').join(' · ')
}
