/**
 * Browser-side persistence for the provider switches: the disabled-name list
 * lives in localStorage (the user's choices survive host restarts). The host
 * never persists it — the tab mirrors the list into host memory through the
 * `promptMiddleware` remote on load and on every switch, and host enforcement
 * reads that mirror.
 */
const STORAGE_KEY = 'dsh.promptMiddleware.disabled';
/** Read the persisted disabled-name list; a missing or malformed value is empty. */
export function loadDisabledProviderNames() {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw === null)
            return [];
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every(id => typeof id === 'string'))
            return parsed;
        return [];
    }
    catch {
        return [];
    }
}
/** Persist the disabled-name list (empty = every provider enabled). */
export function saveDisabledProviderNames(names) {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(names));
    }
    catch {
        // Storage unavailable (private mode / quota): the switch still applies to
        // the running host until reload, just not across sessions.
    }
}
