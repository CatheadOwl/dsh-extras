import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
export type GatesGateLevel = 'blocking' | 'advisory' | 'defer';
export type GatesGateTrigger = 'stop' | 'manual';
/** One row of the flat gate list as the host Remote reports it. */
export interface GatesGateView {
    id: string;
    description: string;
    level: GatesGateLevel;
    on: GatesGateTrigger[];
    source: 'plugin' | 'project';
    /** Per-trigger user-enabled state: turn-stop (fixed) and manual (agent-chosen). */
    stopEnabled: boolean;
    manualEnabled: boolean;
}
export interface GatesSetDisabledRequest {
    stop: string[];
    manual: string[];
    workspace?: string;
}
/** Callbacks the plugin binds from the `gates` Host Remote. */
export interface GatesTabInjected {
    list: (workspace: string | undefined) => Promise<GatesGateView[]>;
    setDisabled: (request: GatesSetDisabledRequest) => Promise<GatesGateView[]>;
}
export type GatesTabProps = PropsRuntime<'settings.plugins.tab'> & PropsLocale<'settings.gates'> & InjectFace<GatesTabInjected>;
/**
 * The Settings → Plugins → Gates tab: a flat list of every gate in the
 * current workspace with two switches per gate — turn-stop (fixed, mandatory)
 * and manual (agent-chosen). The switch lists are persisted in the browser's
 * localStorage and mirrored into host memory on load and on every switch, so
 * turn-stop and /gates honor them immediately.
 */
export declare function GatesTab({ t, useSessions, useWorkspaces, list, setDisabled }: GatesTabProps): import("react").JSX.Element;
