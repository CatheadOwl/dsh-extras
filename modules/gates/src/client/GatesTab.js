import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Button, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import { resolveWorkspacePath } from './workspace-resolve.js';
import css from './GatesTab.module.css';
/**
 * The Settings → Plugins → Gates tab: a flat list of every gate in the
 * current workspace with two switches per gate — turn-stop (fixed, mandatory)
 * and manual (agent-chosen). The switch lists are persisted in the browser's
 * localStorage and mirrored into host memory on load and on every switch, so
 * turn-stop and /gates honor them immediately.
 */
export function GatesTab({ t, useSessions, useWorkspaces, list, setDisabled }) {
    const [state, setState] = useState({ status: 'loading' });
    const [reload, setReload] = useState(0);
    const [pending, setPending] = useState(undefined);
    const sessions = useSessions(listState => listState);
    const workspacePath = useWorkspaces(workspaceState => resolveWorkspacePath(workspaceState, sessions));
    useEffect(() => {
        let current = true;
        setState({ status: 'loading' });
        void list(workspacePath).then((gates) => {
            if (!current)
                return;
            setState({ status: 'ready', gates });
        }, (error) => {
            if (!current)
                return;
            setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        });
        return () => { current = false; };
    }, [reload, workspacePath, list]);
    const toggle = async (gate, trigger) => {
        if (pending !== undefined || state.status !== 'ready')
            return;
        setPending(`${gate.id}:${trigger}`);
        try {
            const next = state.gates.map(candidate => {
                if (candidate.id !== gate.id)
                    return candidate;
                return trigger === 'stop'
                    ? { ...candidate, stopEnabled: !candidate.stopEnabled }
                    : { ...candidate, manualEnabled: !candidate.manualEnabled };
            });
            const stop = next.filter(candidate => !candidate.stopEnabled).map(candidate => candidate.id);
            const manual = next.filter(candidate => !candidate.manualEnabled).map(candidate => candidate.id);
            const gates = await setDisabled({ stop, manual, workspace: workspacePath });
            setState({ status: 'ready', gates });
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
    return (_jsxs("section", { className: css.section, children: [_jsxs("div", { className: css.heading, children: [_jsxs("div", { children: [_jsx("h3", { children: t('title') }), _jsx("p", { className: css.description, children: t('description') })] }), _jsx(Button, { variant: "ghost", size: "sm", icon: _jsx(IconRefreshOutline16, {}), "aria-label": t('refresh'), title: t('refresh'), onClick: () => { setReload(value => value + 1); } })] }), state.gates.length === 0
                ? _jsx("p", { className: css.status, children: t('empty') })
                : (_jsx("ul", { className: css.list, children: state.gates.map(gate => (_jsxs("li", { className: css.row, children: [_jsxs("div", { className: css.copy, children: [_jsx("div", { className: css.name, children: gate.id }), _jsx("div", { className: css.description, children: gate.description }), _jsx("div", { className: css.meta, children: metaLabel(t, gate) })] }), _jsx("div", { className: css.switches, children: gate.on.map(trigger => (_jsxs("div", { className: css.switchGroup, children: [_jsx("span", { className: css.switchCaption, children: triggerLabel(t, trigger) }), _jsx("button", { type: "button", role: "switch", "aria-checked": trigger === 'stop' ? gate.stopEnabled : gate.manualEnabled, "aria-label": `${triggerLabel(t, trigger)}: ${gate.id}`, className: (trigger === 'stop' ? gate.stopEnabled : gate.manualEnabled)
                                                ? `${css.switch} ${css.switchOn}`
                                                : css.switch, disabled: pending !== undefined, onClick: () => { void toggle(gate, trigger); }, children: _jsx("span", { className: css.thumb }) })] }, trigger))) })] }, gate.id))) }))] }));
}
function triggerLabel(t, trigger) {
    return trigger === 'stop' ? t('triggerStop') : t('triggerManual');
}
function metaLabel(t, gate) {
    const level = gate.level === 'blocking'
        ? t('levelBlocking')
        : gate.level === 'advisory' ? t('levelAdvisory') : t('levelDefer');
    const triggers = gate.on
        .map(trigger => trigger === 'stop' ? t('triggerStop') : t('triggerManual'))
        .join(' + ');
    const source = gate.source === 'plugin' ? t('sourcePlugin') : t('sourceProject');
    return [level, triggers, source].filter(segment => segment !== '').join(' · ');
}
