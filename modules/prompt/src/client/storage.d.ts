/**
 * Browser-side persistence for the provider switches: the disabled-name list
 * lives in localStorage (the user's choices survive host restarts). The host
 * never persists it — the tab mirrors the list into host memory through the
 * `promptMiddleware` remote on load and on every switch, and host enforcement
 * reads that mirror.
 */
/** Read the persisted disabled-name list; a missing or malformed value is empty. */
export declare function loadDisabledProviderNames(): string[];
/** Persist the disabled-name list (empty = every provider enabled). */
export declare function saveDisabledProviderNames(names: readonly string[]): void;
