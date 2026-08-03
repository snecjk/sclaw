export type TopNavKey = 'workspace' | 'ops' | 'system';

export interface SideNavItem {
  key: string;
  label: string;
  /** Route path without leading slash, e.g. home / demo / docs */
  path: string;
}

export interface TopNavItem {
  key: TopNavKey;
  label: string;
  children: SideNavItem[];
}

export const TOP_NAV: TopNavItem[] = [
  {
    key: 'workspace',
    label: '工作台',
    children: [
      { key: 'home', label: '首页概览', path: 'home' },
      { key: 'demo', label: '组件示例', path: 'demo' },
    ],
  },
  {
    key: 'ops',
    label: '业务办理',
    children: [
      { key: 'orders', label: '业务列表', path: 'orders' },
      { key: 'reports', label: '数据报表', path: 'reports' },
    ],
  },
  {
    key: 'system',
    label: '系统设置',
    children: [
      { key: 'profile', label: '个人中心', path: 'profile' },
      { key: 'settings', label: '偏好设置', path: 'settings' },
    ],
  },
];

export const DEFAULT_TOP_KEY: TopNavKey = 'workspace';
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

export function findNavByPath(path: string): {
  topKey: TopNavKey;
  sideKey: string;
  sideItems: SideNavItem[];
} {
  const key = path.replace(/^\//, '');
  for (const top of TOP_NAV) {
    const hit = top.children.find((child) => child.path === key);
    if (hit) {
      return { topKey: top.key, sideKey: hit.key, sideItems: top.children };
    }
  }
  const fallback = TOP_NAV[0]!;
  return {
    topKey: fallback.key,
    sideKey: fallback.children[0]!.key,
    sideItems: fallback.children,
  };
}
