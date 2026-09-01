export interface SideNavItem {
  key: string;
  label: string;
  /** Route path without leading slash, e.g. home / demo / docs */
  path: string;
  developerOnly?: boolean;
}

export const SIDE_NAV: SideNavItem[] = [
  { key: 'home', label: '首页', path: 'home' },
  { key: 'example', label: '开发示例', path: 'example', developerOnly: true },
];
export const DEFAULT_PATH = 'home';

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

export function findSideNavByPath(path: string): SideNavItem {
  const key = path.replace(/^\//, '');
  return SIDE_NAV.find((item) => item.path === key) ?? SIDE_NAV[0]!;
}
