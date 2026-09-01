import type { WorkspaceDto } from '@/lib/session-catalog-api';
import { isAppDevSessionKey } from '@/lib/app-dev-session';
import { isProjectNewChatDraftKey } from '@/stores/chat/types';

/** Stable creation-time descending order (newest first); invalid timestamps remain after dated projects. */
export function sortProjectsByCreatedAt(
  workspaces: readonly WorkspaceDto[],
): WorkspaceDto[] {
  return workspaces
    .map((workspace, index) => ({
      workspace,
      index,
      createdAt: Date.parse(workspace.createdAt),
    }))
    .sort((left, right) => {
      const leftTime = Number.isFinite(left.createdAt)
        ? left.createdAt
        : Number.NEGATIVE_INFINITY;
      const rightTime = Number.isFinite(right.createdAt)
        ? right.createdAt
        : Number.NEGATIVE_INFINITY;
      return rightTime - leftTime || left.index - right.index;
    })
    .map(({ workspace }) => workspace);
}

/** The UI-only project new-chat draft is intentionally not renameable. */
export function canRenameSidebarSession(sessionKey: string): boolean {
  return !isProjectNewChatDraftKey(sessionKey);
}

/** Shared double-click behavior for recent and project session rows. */
export function handleSidebarSessionDoubleClick(
  sessionKey: string,
  onStartRename: () => void,
): void {
  if (canRenameSidebarSession(sessionKey)) onStartRename();
}

/** Resolve which project folder should be revealed for the current chat focus. */
export function resolveSidebarProjectFocus(input: {
  currentSessionKey: string | null | undefined;
  pendingProjectId: string | null | undefined;
  sessionWorkspaceByKey: Record<string, string>;
  defaultWorkspaceId: string;
  defaultSessionKey: string;
}): { projectId: string; sessionKey: string | null } | null {
  const {
    currentSessionKey,
    pendingProjectId,
    sessionWorkspaceByKey,
    defaultWorkspaceId,
    defaultSessionKey,
  } = input;

  const pending = pendingProjectId?.trim();
  if (pending && pending !== defaultWorkspaceId) {
    const sessionKey =
      currentSessionKey
      && currentSessionKey !== defaultSessionKey
      ? currentSessionKey
      : null;
    return { projectId: pending, sessionKey };
  }

  if (!currentSessionKey || currentSessionKey === defaultSessionKey) return null;
  if (isAppDevSessionKey(currentSessionKey)) return null;
  const workspaceId = sessionWorkspaceByKey[currentSessionKey];
  if (!workspaceId || workspaceId === defaultWorkspaceId) return null;
  return { projectId: workspaceId, sessionKey: currentSessionKey };
}
