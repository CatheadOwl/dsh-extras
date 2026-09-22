/**
 * Workspace-target resolution for the gates row's configuration page.
 *
 * The page lists the gates of one workspace at a time: the most recently
 * active workspace (latest session `updatedAt`, falling back to the
 * workspace's `createdAt`), else undefined — the browser wire omits the
 * workspace and the server resolves its own cwd. Hosts ≥ 0.1.6-alpha.2
 * removed the client-side global "current session" (explicit Session
 * Provider ownership; a global config page sits under no provider), so
 * the former selected-session-first tier no longer exists to mirror.
 */

import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'

/**
 * Resolve the workspace path the gates tab should address.
 * @param workspaces - the global Workspace snapshot (useWorkspaces).
 * @param sessions - the global Session list snapshot (useSessions).
 * @returns the most recently active workspace path, else undefined
 * (server-cwd fallback).
 */
export function resolveWorkspacePath(
  workspaces: WorkspaceSnapshot,
  sessions: SessionListState,
): string | undefined {
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
