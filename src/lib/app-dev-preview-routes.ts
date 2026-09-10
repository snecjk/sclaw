/**
 * 预览路由下拉的纯函数助手（T03）：
 * - `resolveAppDevRouteUrl`：把路由片段（`#/home` / `/home` / `#home`）拼到当前预览地址；
 * - `matchAppDevRoute`：从当前地址反推出匹配的路由条目（触发器展示当前页）。
 */
import type { AppRouteEntry } from '@/lib/app-dev-api';

/**
 * Hash 片段统一成 `#/x` 形式再比较：`#/home` 与 `#home` 在业务上同一页，
 * 但 HashRouter 路径带 `/`，A2UI 页面 id 不带。
 */
function normalizeHashFragment(hash: string): string {
  const raw = hash.replace(/^#/, '').trim();
  const clean = raw.replace(/^\/+/, '').replace(/\/+$/, '');
  return clean.toLowerCase();
}

/** 拼接路由跳转地址；base 无法解析时返回 null。 */
export function resolveAppDevRouteUrl(baseUrl: string, routePath: string): string | null {
  const base = baseUrl.trim();
  const route = routePath.trim();
  if (!base || !route) return null;
  try {
    const url = new URL(base);
    if (route.startsWith('#')) {
      // hash 赋值会自动处理前导 #；保持路由片段原样（#/home 或 #home）。
      url.hash = route;
      return url.toString();
    }
    url.pathname = route.startsWith('/') ? route : `/${route}`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/** 当前地址命中的路由条目；无命中返回 null（触发器降级展示「页面」）。 */
export function matchAppDevRoute(
  currentUrl: string,
  routes: AppRouteEntry[],
): AppRouteEntry | null {
  if (!currentUrl.trim() || routes.length === 0) return null;
  let url: URL;
  try {
    url = new URL(currentUrl);
  } catch {
    return null;
  }
  const hashFragment = normalizeHashFragment(url.hash);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  for (const route of routes) {
    if (route.path.startsWith('#')) {
      if (hashFragment && normalizeHashFragment(route.path) === hashFragment) return route;
    } else {
      const clean = route.path.replace(/\/+$/, '') || '/';
      if (clean === pathname) return route;
    }
  }
  return null;
}
