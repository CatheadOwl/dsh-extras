import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
/** One row of the flat provider list as the host Remote reports it. */
export interface PromptMiddlewareProviderView {
    name: string;
    kind?: string;
    priority?: number;
    timeoutMs?: number;
    mode: 'always' | 'once';
    source: 'imperative' | 'declarative';
    enabled: boolean;
}
/** Callbacks the plugin binds from the `promptMiddleware` Host Remote. */
export interface PromptMiddlewareTabInjected {
    list: () => Promise<PromptMiddlewareProviderView[]>;
    setDisabled: (ids: string[]) => Promise<PromptMiddlewareProviderView[]>;
}
export type PromptMiddlewareTabProps = PropsRuntime<'settings.plugins.tab'> & PropsLocale<'settings.promptMiddleware'> & InjectFace<PromptMiddlewareTabInjected>;
/**
 * The Settings → Plugins → Prompt Middleware tab: a flat list of every
 * registered provider with one switch per provider. The switch list is
 * persisted in the browser's localStorage and mirrored into host memory on
 * load and on every switch, so pre-step injection honors it immediately.
 */
export declare function PromptMiddlewareTab({ t, list, setDisabled }: PromptMiddlewareTabProps): import("react").JSX.Element;
