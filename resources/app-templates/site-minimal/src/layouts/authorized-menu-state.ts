import {
  findSideNavByPath,
  flattenPageNavItems,
  type SideNavItem,
  type SideNavPageItem,
} from './nav-config';

export type AuthorizedMenuLoadState =
  | { status: 'loading'; items: []; pages: []; error: null }
  | { status: 'error'; items: []; pages: []; error: string }
  | { status: 'empty'; items: []; pages: []; error: null }
  | {
      status: 'ready';
      items: SideNavItem[];
      pages: SideNavPageItem[];
      error: null;
    };

export interface AuthorizedMenuReadyState {
  status: 'ready';
  items: SideNavItem[];
  pages: SideNavPageItem[];
  error: null;
  selectedItem: SideNavPageItem;
  redirectPath: string | null;
}

export const AUTHORIZED_MENU_LOADING_STATE: AuthorizedMenuLoadState = {
  status: 'loading',
  items: [],
  pages: [],
  error: null,
};

export function createAuthorizedMenuResolvedState(
  items: SideNavItem[],
): AuthorizedMenuLoadState {
  const pages = flattenPageNavItems(items);
  if (pages.length === 0) {
    return { status: 'empty', items: [], pages: [], error: null };
  }
  return { status: 'ready', items, pages, error: null };
}

export function createAuthorizedMenuErrorState(error: unknown): AuthorizedMenuLoadState {
  return {
    status: 'error',
    items: [],
    pages: [],
    error: error instanceof Error && error.message.trim()
      ? error.message
      : '应用菜单加载失败',
  };
}

export function createAuthorizedMenuReadyState(
  items: SideNavItem[],
  currentPath: string,
): AuthorizedMenuReadyState {
  const pages = flattenPageNavItems(items);
  const first = pages[0];
  if (!first) throw new Error('授权菜单中没有可访问页面');
  const selected = findSideNavByPath(items, currentPath);
  return {
    status: 'ready',
    items,
    pages,
    error: null,
    selectedItem: selected ?? first,
    redirectPath: selected ? null : first.path,
  };
}
