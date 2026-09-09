/**
 * 侧栏底部账号区展示模式。
 * 展开态用整块账号热区开菜单；收起态保留头像/齿轮紧凑入口。
 */

export type SidebarAccountFooterMode =
  | 'expanded-hotzone'
  | 'collapsed-avatar'
  | 'compact-gear';

/**
 * 根据侧栏布局与折叠态解析底部账号区模式。
 * - expanded-hotzone：无齿轮，账号文字为 DropdownMenuTrigger
 * - collapsed-avatar：折叠头像入口仍可开菜单
 * - compact-gear：无资料卡时的紧凑齿轮入口
 */
export function resolveSidebarAccountFooterMode(options: {
  /** 是否展示用户资料卡片（provincial/full 均为 true） */
  userProfileCard: boolean;
  /** 侧栏是否折叠 */
  sidebarCollapsed: boolean;
}): SidebarAccountFooterMode {
  if (options.userProfileCard && !options.sidebarCollapsed) {
    return 'expanded-hotzone';
  }
  if (options.userProfileCard) {
    return 'collapsed-avatar';
  }
  return 'compact-gear';
}

/** 仅 compact-gear 模式渲染齿轮；展开热区不得出现齿轮 */
export function shouldRenderAccountGearIcon(mode: SidebarAccountFooterMode): boolean {
  return mode === 'compact-gear';
}

type SidebarAccountIdentity = {
  realName?: string | null;
  userName?: string | null;
  code?: string | null;
  empCode?: string | null;
};

/** 侧栏底部展示用姓名：真名优先，否则登录名 */
export function resolveSidebarAccountName(
  user: SidebarAccountIdentity | null | undefined,
): string {
  if (!user) return '';
  return user.realName?.trim() || user.userName?.trim() || '';
}

/**
 * 侧栏底部姓名旁的员工账号/工号。
 * 优先梧桐工号 `code`，其次轩辕 `empCode`，再回落登录名 `userName`；与姓名相同则不重复展示。
 */
export function resolveSidebarAccountEmployeeId(
  user: SidebarAccountIdentity | null | undefined,
): string {
  if (!user) return '';
  const name = resolveSidebarAccountName(user);
  const empId = user.code?.trim() || user.empCode?.trim() || user.userName?.trim() || '';
  if (!empId || empId === name) return '';
  return empId;
}
