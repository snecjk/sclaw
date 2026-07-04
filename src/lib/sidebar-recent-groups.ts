import type { SidebarRecentGroup } from '@/stores/sidebar-recent-groups';

export interface SidebarRecentGroupSection<TSession extends { key: string }> {
  group: SidebarRecentGroup;
  sessions: TSession[];
}

export function buildSidebarRecentGroupSections<TSession extends { key: string }>(input: {
  groups: SidebarRecentGroup[];
  sessionsSortedByRecent: TSession[];
  sessionGroupByKey: Record<string, string>;
}): {
  groupedSections: SidebarRecentGroupSection<TSession>[];
  ungroupedSessions: TSession[];
} {
  const sortedGroups = [...input.groups].sort((a, b) => a.createdAt - b.createdAt);
  const groupIdSet = new Set(sortedGroups.map((g) => g.id));
  const sessionsByGroupId = new Map<string, TSession[]>();

  for (const group of sortedGroups) {
    sessionsByGroupId.set(group.id, []);
  }

  const ungroupedSessions: TSession[] = [];

  for (const session of input.sessionsSortedByRecent) {
    const groupId = input.sessionGroupByKey[session.key];
    if (groupId !== undefined && groupIdSet.has(groupId)) {
      sessionsByGroupId.get(groupId)?.push(session);
    } else {
      ungroupedSessions.push(session);
    }
  }

  const groupedSections = sortedGroups.map((group) => ({
    group,
    sessions: sessionsByGroupId.get(group.id) ?? [],
  }));

  return { groupedSections, ungroupedSessions };
}
