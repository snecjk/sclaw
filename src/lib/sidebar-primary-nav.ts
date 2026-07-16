/**
 * 侧栏 primaryNav 固定区路由 — 与 Sidebar.primaryNav 的 `to` 保持一致。
 *
 * 用途：ContentHeader 在这些路由上隐藏兜底页面标题（侧栏已表达当前功能）；
 * 页面通过 useContentHeader 注入的会话标题仍保留。
 */
import { matchPath } from 'react-router-dom';

const SIDEBAR_PRIMARY_NAV_ROUTE_MATCHERS: ReadonlyArray<{ path: string; end?: boolean }> = [
  { path: '/', end: true },
  { path: '/scheduled-tasks' },
  { path: '/my-tasks' },
  { path: '/cron' },
  { path: '/skills' },
  { path: '/workflow' },
  { path: '/more-apps' },
  { path: '/models' },
  { path: '/data-center' },
];

export interface SidebarPrimaryNavVisibilityOptions {
  primaryMyData: boolean;
  siteDepartmentTypesLoaded: boolean;
  isSite: boolean;
  isProduction: boolean;
}

/** Resolve account/environment visibility without coupling public entries to site identity. */
export function isSidebarPrimaryNavItemVisible(
  path: string,
  options: SidebarPrimaryNavVisibilityOptions,
): boolean {
  if (path === '/models' && !options.primaryMyData) return false;
  if (path === '/data-center' && (!options.siteDepartmentTypesLoaded || !options.isSite)) return false;
  if ((path === '/scheduled-tasks' || path === '/cron') && options.isProduction) return false;
  return true;
}

/** 当前 pathname 是否命中侧栏 primaryNav 固定入口（非工作台二级 nav） */
export function isSidebarPrimaryNavRoute(pathname: string): boolean {
  return SIDEBAR_PRIMARY_NAV_ROUTE_MATCHERS.some(({ path, end }) =>
    matchPath({ path, end: end ?? false }, pathname) != null,
  );
}
