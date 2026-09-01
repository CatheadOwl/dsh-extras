/**
 * Workspace-target resolution for the gates settings tab.
 *
 * The tab lists the gates of one workspace at a time, mirroring the CogGit
 * init tab's policy (UiWorkspaceService.startSession): the workspace owning
 * the currently selected session first, then the most recently active
 * workspace, then undefined — the browser wire omits the workspace and the
 * server resolves its own cwd.
 */

import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'

/**
 * Resolve the workspace path the gates tab should address.
 * @param workspaces - the global Workspace snapshot (useWorkspaces).
 * @param sessions - the global Session list snapshot (useSessions).
 * @returns the owning workspace path of the selected session, else the most
 * recently active workspace path, else undefined (server-cwd fallback).
 */
export function resolveWorkspacePath(
  workspaces: WorkspaceSnapshot,
  sessions: SessionListState,
): string | undefined {
  const current = sessions.current
  const owned = current === undefined
    ? undefined
    : workspaces.items.find(item => item.sessionIds.includes(current))
  if (owned !== undefined) return owned.path
  if (workspaces.phase !== 'ready' || sessions.phase !== 'ready') return undefined
  return mostRecentlyActive(workspaces.items, sessions.byId)?.path
}

function mostRecentlyActive(
  items: readonly WorkspaceView[],
  byId: SessionListState['byId'],
): WorkspaceView | undefined {
  let selected: WorkspaceView | undefined
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const workspace of items) {
    let latest = Number.NEGATIVE_INFINITY
    for (const sessionId of workspace.sessionIds) {
      const session = byId[sessionId]
      if (session !== undefined) latest = Math.max(latest, session.updatedAt)
    }
    if (latest === Number.NEGATIVE_INFINITY) latest = Date.parse(workspace.createdAt)
    if (selected === undefined || latest > selectedTime) {
      selected = workspace
      selectedTime = latest
    }
  }
  return selected
}
