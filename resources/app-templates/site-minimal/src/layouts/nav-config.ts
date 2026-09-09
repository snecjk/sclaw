interface SideNavItemBase {
  key: string;
  label: string;
  developerOnly?: boolean;
}

export interface SideNavPageItem extends SideNavItemBase {
  /** Route path without leading slash, e.g. home / demo / docs. */
  path: string;
  children?: never;
}

export interface SideNavDirectoryItem extends SideNavItemBase {
  path?: never;
  children: SideNavItem[];
}

export type SideNavItem = SideNavPageItem | SideNavDirectoryItem;

export const SIDE_NAV: SideNavPageItem[] = [
  { key: 'home', label: '首页', path: 'home' },
  { key: 'a2ui-home', label: 'A2UI 首页', path: 'a2ui-home', developerOnly: true },
  { key: 'customer-list', label: '客户列表', path: 'customer-list', developerOnly: true },
  { key: 'example', label: '开发示例', path: 'example', developerOnly: true },
];

export const DEFAULT_PATH = 'home';

export function flattenPageNavItems(items: readonly SideNavItem[]): SideNavPageItem[] {
  return items.flatMap((item) => (
    item.children ? flattenPageNavItems(item.children) : [item]
  ));
}

export function findSideNavByPath(path: string): SideNavPageItem;
export function findSideNavByPath(
  items: readonly SideNavItem[],
  path: string,
): SideNavPageItem | undefined;
export function findSideNavByPath(
  itemsOrPath: readonly SideNavItem[] | string,
  maybePath?: string,
): SideNavPageItem | undefined {
  const items = typeof itemsOrPath === 'string' ? SIDE_NAV : itemsOrPath;
  const path = typeof itemsOrPath === 'string' ? itemsOrPath : (maybePath ?? '');
  const key = path.replace(/^\//, '');
  const found = flattenPageNavItems(items).find((item) => item.path === key);
  if (typeof itemsOrPath === 'string') return found ?? SIDE_NAV[0]!;
  return found;
}

export function toRoutePath(path: string): string {
  const normalized = path.replace(/^#\/?/, '').replace(/^\//, '').trim();
  return `/${normalized || DEFAULT_PATH}`;
}

/** Normalize pathname or legacy hash fragment to nav path key. */
export function pathFromLocation(pathnameOrHash: string, search = ''): string {
  const raw = pathnameOrHash.trim();
  if (raw.startsWith('#')) {
    const fromHash = raw.replace(/^#\/?/, '').split('?')[0]?.trim();
    if (fromHash) return fromHash.replace(/^\//, '');
  } else {
    const fromPath = raw.replace(/^\//, '').split('?')[0]?.trim();
    if (fromPath) return fromPath;
  }
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const page = params.get('page')?.trim();
  return page || DEFAULT_PATH;
}
