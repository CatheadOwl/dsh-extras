/**
 * Browser-side persistence for the gate switches: the per-trigger disabled
 * lists live in localStorage (the user's choices survive host restarts). The
 * host never persists them — the tab mirrors both lists into host memory
 * through the `gates` remote on load and on every switch, and host
 * enforcement reads that mirror. Each gate has two independent dimensions —
 * turn-stop (fixed, mandatory) and manual (agent-chosen) — stored as separate
 * id lists.
 */
/** The browser-owned switch state: which gate ids are disabled per trigger. */
export interface DisabledTriggers {
    stop: string[];
    manual: string[];
}
/** Read the persisted per-trigger disabled lists; a missing or malformed value is empty. */
export declare function loadDisabledTriggers(): DisabledTriggers;
/** Persist the per-trigger disabled lists (empty = every dimension of every gate enabled). */
export declare function saveDisabledTriggers(state: DisabledTriggers): void;
