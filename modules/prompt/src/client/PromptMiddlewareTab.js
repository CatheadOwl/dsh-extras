import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Button, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './PromptMiddlewareTab.module.css';
/**
 * The Settings → Plugins → Prompt Middleware tab: a flat list of every
 * registered provider with one switch per provider. The switch list is
 * persisted in the browser's localStorage and mirrored into host memory on
 * load and on every switch, so pre-step injection honors it immediately.
 */
export function PromptMiddlewareTab({ t, list, setDisabled }) {
    const [state, setState] = useState({ status: 'loading' });
    const [reload, setReload] = useState(0);
    const [pending, setPending] = useState(undefined);
    useEffect(() => {
        let current = true;
        setState({ status: 'loading' });
        void list().then((providers) => {
            if (!current)
                return;
            setState({ status: 'ready', providers });
        }, (error) => {
            if (!current)
                return;
            setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        });
        return () => { current = false; };
    }, [reload, list]);
    const toggle = async (provider) => {
        if (pending !== undefined || state.status !== 'ready')
            return;
        setPending(provider.name);
        try {
            const next = state.providers.map(candidate => candidate.name === provider.name ? { ...candidate, enabled: !candidate.enabled } : candidate);
            const ids = next.filter(candidate => !candidate.enabled).map(candidate => candidate.name);
            const providers = await setDisabled(ids);
            setState({ status: 'ready', providers });
        }
        catch (error) {
            setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
        finally {
            setPending(undefined);
        }
    };
    if (state.status === 'loading') {
        return _jsx("p", { className: css.status, children: t('loading') });
    }
    if (state.status === 'error') {
        return (_jsxs("div", { className: css.failure, children: [_jsx("p", { role: "alert", children: t('error') }), _jsx("code", { children: state.message }), _jsx(Button, { variant: "outline", size: "sm", icon: _jsx(IconRefreshOutline16, {}), onClick: () => { setReload(value => value + 1); }, children: t('retry') })] }));
    }
    return (_jsxs("section", { className: css.section, children: [_jsxs("div", { className: css.heading, children: [_jsxs("div", { children: [_jsx("h3", { children: t('title') }), _jsx("p", { className: css.description, children: t('description') })] }), _jsx(Button, { variant: "ghost", size: "sm", icon: _jsx(IconRefreshOutline16, {}), "aria-label": t('refresh'), title: t('refresh'), onClick: () => { setReload(value => value + 1); } })] }), state.providers.length === 0
                ? _jsx("p", { className: css.status, children: t('empty') })
                : (_jsx("ul", { className: css.list, children: state.providers.map(provider => (_jsxs("li", { className: css.row, children: [_jsxs("div", { className: css.copy, children: [_jsx("div", { className: css.name, children: provider.name }), _jsx("div", { className: css.meta, children: metaLabel(t, provider) })] }), _jsx("button", { type: "button", role: "switch", "aria-checked": provider.enabled, "aria-label": provider.name, className: provider.enabled ? `${css.switch} ${css.switchOn}` : css.switch, disabled: pending !== undefined, onClick: () => { void toggle(provider); }, children: _jsx("span", { className: css.thumb }) })] }, provider.name))) }))] }));
}
function metaLabel(t, provider) {
    const mode = provider.mode === 'always' ? t('modeAlways') : t('modeOnce');
    const source = provider.source === 'imperative' ? t('sourceImperative') : t('sourceDeclarative');
    const priority = provider.priority === undefined ? undefined : `${t('priority')} ${provider.priority}`;
    const timeout = provider.timeoutMs === undefined ? undefined : `${t('timeout')} ${provider.timeoutMs}ms`;
    return [source, mode, provider.kind, priority, timeout]
        .filter(segment => segment !== undefined && segment !== '')
        .join(' · ');
}
