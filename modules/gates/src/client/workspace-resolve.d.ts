/**
 * Workspace-target resolution for the gates settings tab.
 *
 * The tab lists the gates of one workspace at a time, mirroring the CogGit
 * init tab's policy (UiWorkspaceService.startSession): the workspace owning
 * the currently selected session first, then the most recently active
 * workspace, then undefined — the browser wire omits the workspace and the
 * server resolves its own cwd.
 */
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client';
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client';
/**
 * Resolve the workspace path the gates tab should address.
 * @param workspaces - the global Workspace snapshot (useWorkspaces).
 * @param sessions - the global Session list snapshot (useSessions).
 * @returns the owning workspace path of the selected session, else the most
 * recently active workspace path, else undefined (server-cwd fallback).
 */
export declare function resolveWorkspacePath(workspaces: WorkspaceSnapshot, sessions: SessionListState): string | undefined;
