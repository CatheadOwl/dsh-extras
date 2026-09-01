import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type PromptMiddlewareLocaleKey } from './locales.js';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'settings.promptMiddleware': PromptMiddlewareLocaleKey;
    }
}
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
