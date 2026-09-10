import type { SideNavItem } from '../layouts/nav-config';
import { request as defaultRequest } from '../lib/request';

const SITE_MENU_ORIGINS = {
  daily: 'https://baseinfo-aimemory-test.sto.cn',
  stage: 'https://pre-baseinfo-aimemory.sto.cn',
  online: 'https://baseinfo-aimemory.sto.cn',
} as const;

type RequestImpl = <T>(url: string, options?: { method?: 'GET' }) => Promise<T>;

interface LoadAuthorizedSiteMenusDependencies {
  isDev?: boolean;
  hostname?: string;
  pathname?: string;
  config?: unknown;
  request?: RequestImpl;
}

interface ResolveSiteApplicationIdOptions {
  isDev: boolean;
  pathname: string;
  config?: unknown;
}

export function resolveSiteMenuOrigin(hostname: string): string {
  const host = hostname.trim().toLowerCase();
  if (host.includes('test') || host.includes('daily')) return SITE_MENU_ORIGINS.daily;
  if (host.includes('pre')) return SITE_MENU_ORIGINS.stage;
  return SITE_MENU_ORIGINS.online;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function resolveSiteApplicationId({
  isDev,
  pathname,
  config,
}: ResolveSiteApplicationIdOptions): string {
  if (!isDev) {
    const match = pathname.match(
      /(?:^|\/)ai-apps(?:-[a-z0-9-]+)?\/(app_[A-Za-z0-9_-]+)(?:\/|$)/i,
    );
    if (!match?.[1]) throw new Error('无法从发布地址解析应用编码');
    return match[1];
  }

  const runtimeConfig = config ?? (
    window as unknown as { __STO_SSO_AUTH_CONFIG__?: unknown }
  ).__STO_SSO_AUTH_CONFIG__;
  const applicationId = isRecord(runtimeConfig) && typeof runtimeConfig.applicationId === 'string'
    ? runtimeConfig.applicationId.trim()
    : '';
  if (!applicationId) throw new Error('缺少应用编码，无法加载菜单');
  return applicationId;
}

function readRequiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`菜单接口响应不合法：缺少 ${key}`);
  }
  return value.trim();
}

function sortOrder(row: Record<string, unknown>): number {
  return typeof row.sort_order === 'number' && Number.isFinite(row.sort_order)
    ? row.sort_order
    : Number.MAX_SAFE_INTEGER;
}

function normalizeResourcePath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('菜单接口响应不合法：页面缺少 resource_path');
  }
  const path = value.trim();
  if (!path.startsWith('/') || path.startsWith('//') || /^\w+:\/\//.test(path)) {
    throw new Error('菜单接口响应不合法：resource_path 必须是站内路径');
  }
  const normalized = path.slice(1);
  if (!normalized) throw new Error('菜单接口响应不合法：页面缺少 resource_path');
  return normalized;
}

function normalizeMenuRows(rows: unknown[]): SideNavItem[] {
  return rows
    .filter((row): row is Record<string, unknown> => (
      isRecord(row) && row.status === 'active' && row.is_visible === true
    ))
    .sort((left, right) => sortOrder(left) - sortOrder(right))
    .map((row): SideNavItem | null => {
      const key = readRequiredString(row, 'menu_code');
      const label = readRequiredString(row, 'menu_name');
      if (row.menu_type === 'page') {
        return { key, label, path: normalizeResourcePath(row.resource_path) };
      }
      if (row.menu_type !== 'directory' || !Array.isArray(row.children)) {
        throw new Error('菜单接口响应不合法：menu_type 或 children 无效');
      }
      const children = normalizeMenuRows(row.children);
      return children.length > 0 ? { key, label, children } : null;
    })
    .filter((item): item is SideNavItem => item !== null);
}

export function normalizeAuthorizedMenus(payload: unknown): SideNavItem[] {
  if (!isRecord(payload) || payload.success !== true || !Array.isArray(payload.data)) {
    throw new Error('菜单接口响应不合法');
  }

  return normalizeMenuRows(payload.data);
}

export async function loadAuthorizedSiteMenus(
  dependencies: LoadAuthorizedSiteMenusDependencies = {},
): Promise<SideNavItem[]> {
  const isDev = dependencies.isDev ?? import.meta.env.DEV;
  const hostname = dependencies.hostname ?? window.location.hostname;
  const pathname = dependencies.pathname ?? window.location.pathname;
  const applicationId = resolveSiteApplicationId({
    isDev,
    pathname,
    config: dependencies.config,
  });
  const path = `/api/v1/site-apps/${encodeURIComponent(applicationId)}/auth/menu`;
  const url = isDev
    ? `/proxy/siteapp-menu${path}`
    : `${resolveSiteMenuOrigin(hostname)}${path}`;
  const payload = await (dependencies.request ?? defaultRequest)<unknown>(url, { method: 'GET' });
  return normalizeAuthorizedMenus(payload);
}
