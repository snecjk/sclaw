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

/** 从 i18n 默认名（如「我的分组1」）解析前缀，返回下一个未占用的「前缀+序号」 */
export function suggestNextSidebarRecentGroupName(
  existingGroupNames: readonly string[],
  defaultGroupNameExample: string,
): string {
  const trimmedExample = defaultGroupNameExample.trim();
  const exampleMatch = trimmedExample.match(/^(.*?)(\d+)$/);
  if (!exampleMatch) {
    return trimmedExample;
  }

  const prefix = exampleMatch[1] ?? trimmedExample;
  const parsedStart = Number.parseInt(exampleMatch[2] ?? '1', 10);
  const startNum = Number.isFinite(parsedStart) && parsedStart > 0 ? parsedStart : 1;

  const usedNumbers = new Set<number>();
  const namePattern = new RegExp(`^${escapeRegExpForSidebarGroupName(prefix)}(\\d+)$`);

  for (const name of existingGroupNames) {
    const nameMatch = name.trim().match(namePattern);
    if (!nameMatch) continue;
    const n = Number.parseInt(nameMatch[1] ?? '', 10);
    if (Number.isFinite(n) && n > 0) {
      usedNumbers.add(n);
    }
  }

  let candidate = startNum;
  while (usedNumbers.has(candidate)) {
    candidate += 1;
  }
  return `${prefix}${candidate}`;
}

function escapeRegExpForSidebarGroupName(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
