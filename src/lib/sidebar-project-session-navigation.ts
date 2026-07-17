import type { WorkspaceDto } from '@/lib/session-catalog-api';
import { isProjectNewChatDraftKey } from '@/stores/chat/types';

/** Stable creation-time ascending order; invalid timestamps remain after dated projects. */
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
        : Number.POSITIVE_INFINITY;
      const rightTime = Number.isFinite(right.createdAt)
        ? right.createdAt
        : Number.POSITIVE_INFINITY;
      return leftTime - rightTime || left.index - right.index;
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
