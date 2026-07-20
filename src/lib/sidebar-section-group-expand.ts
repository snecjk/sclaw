/**
 * 侧栏分区「一级组」展开集合 / 批量展开收起纯函数。
 * 项目与任务各自维护 map，不共用状态；不保存历史快照。
 */

export type SidebarGroupExpandMap = Record<string, boolean>;

/**
 * 是否每一个可展开组都已展开。
 * 空列表返回 false（无批量目标，不视为「全部展开」）。
 */
export function areAllExpandableGroupsExpanded(
  map: SidebarGroupExpandMap,
  expandableIds: string[],
): boolean {
  if (expandableIds.length === 0) {
    return false;
  }
  return expandableIds.every((id) => map[id] === true);
}

/** 展开全部：每个传入 ID 显式为 true */
export function expandAllGroups(expandableIds: string[]): SidebarGroupExpandMap {
  const next: SidebarGroupExpandMap = {};
  for (const id of expandableIds) {
    next[id] = true;
  }
  return next;
}

/** 收起全部：每个传入 ID 显式为 false */
export function collapseAllGroups(expandableIds: string[]): SidebarGroupExpandMap {
  const next: SidebarGroupExpandMap = {};
  for (const id of expandableIds) {
    next[id] = false;
  }
  return next;
}

/** 切换单个组展开；不影响其它组 */
export function toggleGroupExpanded(
  map: SidebarGroupExpandMap,
  groupId: string,
): SidebarGroupExpandMap {
  return {
    ...map,
    [groupId]: !(map[groupId] === true),
  };
}

/** 仅追加展开目标组（自动聚焦），不关闭其它组 */
export function appendGroupExpanded(
  map: SidebarGroupExpandMap,
  groupId: string,
): SidebarGroupExpandMap {
  if (map[groupId] === true) {
    return map;
  }
  return { ...map, [groupId]: true };
}
