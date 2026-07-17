import type { CatalogSessionDto, SessionGroupDto } from '@/lib/session-catalog-api';
import { useSidebarRecentGroupsStore } from '@/stores/sidebar-recent-groups';

export function hydrateRecentGroupsFromCatalog(
  groups: SessionGroupDto[],
  sessions: CatalogSessionDto[],
): void {
  if (groups.length === 0 && sessions.every((s) => !s.groupId)) return;
  const mappedGroups = groups.map((group) => {
    const createdAt = group.createdAt ?? new Date().toISOString();
    return {
      id: group.id,
      name: group.name,
      createdAt: Date.parse(createdAt) || Date.now(),
      updatedAt: Date.parse(group.updatedAt ?? createdAt) || Date.now(),
    };
  });
  const assignments = Object.fromEntries(
    sessions
      .filter((row) => row.groupId)
      .map((row) => [row.sessionKey, row.groupId as string]),
  );
  useSidebarRecentGroupsStore.setState((state) => ({
    groups: mappedGroups.length > 0 ? mappedGroups : state.groups,
    sessionGroupByKey: Object.keys(assignments).length > 0
      ? { ...state.sessionGroupByKey, ...assignments }
      : state.sessionGroupByKey,
  }));
}
