/**
 * Browser-side persistence for the gate switches: the per-trigger disabled
 * lists live in localStorage (the user's choices survive host restarts). The
 * host never persists them — the tab mirrors both lists into host memory
 * through the `gates` remote on load and on every switch, and host
 * enforcement reads that mirror. Each gate has two independent dimensions —
 * turn-stop (fixed, mandatory) and manual (agent-chosen) — stored as separate
 * id lists.
 */

const STORAGE_KEY = 'dsh.gates.disabled'

/** The browser-owned switch state: which gate ids are disabled per trigger. */
export interface DisabledTriggers {
  stop: string[]
  manual: string[]
}

/** Read the persisted per-trigger disabled lists; a missing or malformed value is empty. */
export function loadDisabledTriggers(): DisabledTriggers {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return { stop: [], manual: [] }
    const parsed: unknown = JSON.parse(raw)
    // W8-era format: a bare id array meaning "fully disabled" — map it to both
    // dimensions off so an upgrade never silently re-enables switched-off gates.
    if (Array.isArray(parsed) && parsed.every(id => typeof id === 'string')) {
      return { stop: parsed, manual: parsed }
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { stop: [], manual: [] }
    const value = parsed as Record<string, unknown>
    const isIdList = (item: unknown): item is string[] =>
      Array.isArray(item) && item.every(id => typeof id === 'string')
    return {
      stop: isIdList(value.stop) ? value.stop : [],
      manual: isIdList(value.manual) ? value.manual : [],
    }
  } catch {
    return { stop: [], manual: [] }
  }
}

/** Persist the per-trigger disabled lists (empty = every dimension of every gate enabled). */
export function saveDisabledTriggers(state: DisabledTriggers): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage unavailable (private mode / quota): the switch still applies to
    // the running host until reload, just not across sessions.
  }
}
