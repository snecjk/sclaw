import { normalizeSiteAppPageType, type SiteAppPageType } from './site-app-catalog';
import type { SiteappMenuItemInput } from './siteapp-menu-sync';

export interface SkippedNavItem {
  label: string;
  reason: string;
  path?: string;
}

export interface SiteappMenuScanResult {
  menus: SiteappMenuItemInput[];
  skipped: SkippedNavItem[];
  source: 'top-nav' | 'side-nav' | 'routes' | 'mixed' | 'empty';
}

const SYNTHETIC_ROOT_KEYS = new Set(['root', 'index', 'c-a-root', 'app-root']);

export function isSyntheticRootNav(key: string, label: string): boolean {
  const normalizedKey = key.trim().toLowerCase();
  const normalizedLabel = label.trim();
  return SYNTHETIC_ROOT_KEYS.has(normalizedKey)
    || normalizedLabel === '根目录'
    || normalizedLabel === '根节点';
}

function sliceBalanced(source: string, openIndex: number): string | null {
  const open = source[openIndex];
  const close = open === '[' ? ']' : open === '{' ? '}' : '';
  if (!close) return null;
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i += 1;
        i += 1;
      }
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  return null;
}

function extractExportedArray(source: string, exportName: string): string | null {
  const match = new RegExp(`export const ${exportName}\\b[^=]*=\\s*\\[`).exec(source);
  if (!match || match.index == null) return null;
  const openIndex = match.index + match[0].length - 1;
  return sliceBalanced(source, openIndex);
}

function splitTopLevelObjects(body: string): string[] {
  const objects: string[] = [];
  let cursor = 0;
  while (cursor < body.length) {
    const openIndex = body.indexOf('{', cursor);
    if (openIndex < 0) break;
    const inner = sliceBalanced(body, openIndex);
    if (inner == null) break;
    objects.push(inner);
    cursor = openIndex + inner.length + 2;
  }
  return objects;
}

function readStringField(objectSource: string, field: string): string {
  const match = new RegExp(`\\b${field}\\s*:\\s*['"]([^'"]+)['"]`).exec(objectSource);
  return match?.[1]?.trim() ?? '';
}

function readBooleanTrue(objectSource: string, field: string): boolean {
  return new RegExp(`\\b${field}\\s*:\\s*true\\b`).test(objectSource);
}

function sanitizeMenuCode(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'menu';
}

function leafMenu(item: { key: string; label: string; path: string }, parentCode: string | null): SiteappMenuItemInput {
  const path = item.path.replace(/^\//, '');
  return {
    menu_code: sanitizeMenuCode(item.key || path),
    parent_code: parentCode,
    menu_name: item.label || path || item.key,
    menu_type: 'page',
    resource_path: path ? `/${path}` : null,
  };
}

interface NavLeaf {
  key: string;
  label: string;
  path: string;
  developerOnly: boolean;
}

interface NavGroup extends NavLeaf {
  children: NavLeaf[];
}

function stripArrayField(objectSource: string, field: string): { rest: string; body: string } {
  const match = new RegExp(`\\b${field}\\s*:\\s*\\[`).exec(objectSource);
  if (!match || match.index == null) return { rest: objectSource, body: '' };
  const openIndex = match.index + match[0].length - 1;
  const inner = sliceBalanced(objectSource, openIndex);
  if (inner == null) return { rest: objectSource, body: '' };
  return {
    rest: `${objectSource.slice(0, match.index)}${objectSource.slice(openIndex + inner.length + 1)}`,
    body: inner,
  };
}

function parseLeaf(objectSource: string): NavLeaf {
  return {
    key: readStringField(objectSource, 'key'),
    label: readStringField(objectSource, 'label'),
    path: readStringField(objectSource, 'path'),
    developerOnly: readBooleanTrue(objectSource, 'developerOnly'),
  };
}

function parseNavGroup(objectSource: string): NavGroup {
  const fromChildren = stripArrayField(objectSource, 'children');
  const extracted = fromChildren.body ? fromChildren : stripArrayField(objectSource, 'items');
  return {
    ...parseLeaf(extracted.rest),
    children: splitTopLevelObjects(extracted.body).map((child) => (
      parseLeaf(stripArrayField(child, 'children').rest)
    )),
  };
}

function visibleLeaves(children: NavLeaf[], skipped: SkippedNavItem[]): NavLeaf[] {
  return children.filter((child) => {
    if (child.developerOnly) {
      skipped.push({ label: child.label || child.key, reason: 'developerOnly', path: child.path || child.key });
      return false;
    }
    return Boolean(child.key || child.path);
  });
}

function scanNavGroups(
  groups: NavGroup[],
  input: {
    pageType: ReturnType<typeof normalizeSiteAppPageType>;
    appName?: string;
    source: 'top-nav' | 'side-nav';
  },
): SiteappMenuScanResult {
  const skipped: SkippedNavItem[] = [];
  const hoistSynthetic = groups.length === 1 && isSyntheticRootNav(groups[0]!.key, groups[0]!.label);

  if (input.pageType === 'assets') {
    const first = groups.find((group) => !group.developerOnly && !isSyntheticRootNav(group.key, group.label))
      ?? groups.find((group) => !group.developerOnly)
      ?? groups[0];
    const name = first?.label?.trim() || input.appName?.trim() || '工作台';
    const firstPath = first?.children[0]?.path || first?.path || 'home';
    return {
      source: input.source,
      skipped: groups.filter((group) => group !== first).map((group) => ({
        label: group.label || group.key,
        reason: 'assets 应用只同步一个一级菜单',
      })),
      menus: [{
        menu_code: sanitizeMenuCode(first?.key || 'home'),
        parent_code: null,
        menu_name: name,
        menu_type: 'page',
        resource_path: `/${firstPath.replace(/^\//, '')}`,
      }],
    };
  }

  const menus: SiteappMenuItemInput[] = [];
  for (const group of groups) {
    if (group.developerOnly) {
      skipped.push({ label: group.label || group.key, reason: 'developerOnly', path: group.path || group.key });
      continue;
    }
    const children = visibleLeaves(group.children, skipped);
    if (hoistSynthetic || isSyntheticRootNav(group.key, group.label)) {
      skipped.push({ label: group.label || group.key || '根目录', reason: '默认重定向，不作为菜单目录' });
      for (const child of children) menus.push(leafMenu(child, null));
      continue;
    }
    if (children.length > 0) {
      const directoryCode = sanitizeMenuCode(group.key || group.label);
      menus.push({
        menu_code: directoryCode,
        parent_code: null,
        menu_name: group.label || group.key,
        menu_type: 'directory',
        resource_path: null,
      });
      for (const child of children) menus.push(leafMenu(child, directoryCode));
      continue;
    }
    if (group.key || group.path) menus.push(leafMenu(group, null));
  }
  return { menus, skipped, source: input.source };
}

export function scanSiteappMenusFromNavSource(
  source: string,
  input: { pageType?: SiteAppPageType | string | null; appName?: string },
): SiteappMenuScanResult {
  const pageType = normalizeSiteAppPageType(input.pageType);
  const topBody = extractExportedArray(source, 'TOP_NAV');
  const sideBody = extractExportedArray(source, 'SIDE_NAV');

  if (topBody != null && topBody.trim()) {
    return scanNavGroups(
      splitTopLevelObjects(topBody).map(parseNavGroup),
      { pageType, appName: input.appName, source: 'top-nav' },
    );
  }

  if (sideBody != null && sideBody.trim()) {
    return scanNavGroups(
      splitTopLevelObjects(sideBody).map(parseNavGroup),
      { pageType, appName: input.appName, source: 'side-nav' },
    );
  }

  return { menus: [], skipped: [], source: 'empty' };
}

function normalizeMenuPath(path: string): string {
  return path.trim().replace(/^\//, '').replace(/\/+$/, '').toLowerCase();
}

function isIgnoredRoutePath(path: string): boolean {
  const key = normalizeMenuPath(path);
  if (!key || key === '*' || key === 'index') return true;
  if (key.includes(':') || key.includes('*')) return true;
  if (key === '404' || key === 'not-found' || key === 'notfound') return true;
  return false;
}

function humanizeRouteLabel(path: string, component?: string): string {
  if (component) {
    const base = component.replace(/(?:Page|View|Screen|Layout|Component)$/u, '');
    const spaced = base.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
    if (spaced) return spaced;
  }
  const leaf = normalizeMenuPath(path).split('/').filter(Boolean).pop() ?? path;
  return leaf.replace(/[-_]+/g, ' ').trim() || path;
}

function looksLikePagePath(path: string): boolean {
  const key = normalizeMenuPath(path);
  if (isIgnoredRoutePath(key)) return false;
  if (/^(api|assets|static|public|src|node_modules)\b/i.test(key)) return false;
  if (key.includes('.') || key.includes('?') || key.includes('#')) return false;
  if (key.split('/').filter(Boolean).length > 4) return false;
  return /^[a-z0-9][a-z0-9/_-]*$/i.test(key);
}

const ROUTE_OBJECT_HINT =
  /\b(?:element|Component|component|lazy|permission|permissions|auth|access|guard|roles|role|code|menuCode|menu_code|menuName|menu_name|label|title|icon|visible|hidden|canAccess|resourcePath|resource_path|exact)\b/;

function readObjectComponent(objectSource: string): string | undefined {
  const match = /\b(?:element|Component|component)\s*:\s*([A-Za-z_][\w]*)/.exec(objectSource);
  return match?.[1];
}

export function extractConfigRouteEntries(source: string): Array<{ path: string; component?: string; label?: string }> {
  const entries: Array<{ path: string; component?: string; label?: string }> = [];
  let cursor = 0;
  while (cursor < source.length) {
    const openIndex = source.indexOf('{', cursor);
    if (openIndex < 0) break;
    const inner = sliceBalanced(source, openIndex);
    if (inner == null) {
      cursor = openIndex + 1;
      continue;
    }
    cursor = openIndex + 1;
    if (!ROUTE_OBJECT_HINT.test(inner)) continue;
    const path = readStringField(inner, 'path')
      || readStringField(inner, 'to')
      || readStringField(inner, 'href')
      || readStringField(inner, 'resource_path')
      || readStringField(inner, 'resourcePath');
    if (!path || !looksLikePagePath(path)) continue;
    const label = readStringField(inner, 'label')
      || readStringField(inner, 'title')
      || readStringField(inner, 'menu_name')
      || readStringField(inner, 'menuName')
      || readStringField(inner, 'name');
    entries.push({
      path: normalizeMenuPath(path),
      component: readObjectComponent(inner),
      label: label || undefined,
    });
  }
  return entries;
}

export function extractJsxRouteEntries(source: string): Array<{ path: string; component?: string }> {
  const entries: Array<{ path: string; component?: string }> = [];
  for (const attrs of extractRouteAttributeBlocks(source)) {
    if (/\b<Navigate\b/.test(attrs) || /\belement\s*=\s*\{\s*<Navigate\b/.test(attrs)) continue;
    const path = /\bpath\s*=\s*['"`]([^'"`]+)['"`]/.exec(attrs)?.[1]?.trim()
      ?? /\bpath\s*=\s*\{\s*['"`]([^'"`$]+)['"`]\s*\}/.exec(attrs)?.[1]?.trim();
    if (!path || isIgnoredRoutePath(path)) continue;
    const component = /\belement\s*=\s*\{\s*<\s*([A-Za-z_][\w]*)/.exec(attrs)?.[1];
    entries.push({ path: normalizeMenuPath(path), component });
  }
  return entries;
}

function extractRouteAttributeBlocks(source: string): string[] {
  const blocks: string[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf('<Route', cursor);
    if (start < 0) break;
    let index = start + 6;
    let braces = 0;
    let quote: string | null = null;
    let found = false;
    while (index < source.length) {
      const ch = source[index];
      if (quote) {
        if (ch === '\\') {
          index += 2;
          continue;
        }
        if (ch === quote) quote = null;
        index += 1;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
        index += 1;
        continue;
      }
      if (ch === '{') {
        braces += 1;
        index += 1;
        continue;
      }
      if (ch === '}') {
        braces -= 1;
        index += 1;
        continue;
      }
      if (braces === 0 && source.startsWith('/>', index)) {
        blocks.push(source.slice(start, index + 2));
        cursor = index + 2;
        found = true;
        break;
      }
      if (braces === 0 && ch === '>') {
        blocks.push(source.slice(start, index + 1));
        cursor = index + 1;
        found = true;
        break;
      }
      index += 1;
    }
    if (!found) break;
  }
  return blocks;
}

function coveredPaths(menus: SiteappMenuItemInput[]): Set<string> {
  const keys = new Set<string>();
  for (const menu of menus) {
    if (menu.resource_path) keys.add(normalizeMenuPath(menu.resource_path));
    if (menu.menu_code) keys.add(normalizeMenuPath(menu.menu_code));
  }
  return keys;
}

function mergeUniqueMenus(base: SiteappMenuItemInput[], extra: SiteappMenuItemInput[]): SiteappMenuItemInput[] {
  const seen = coveredPaths(base);
  const next = [...base];
  for (const item of extra) {
    const pathKey = item.resource_path ? normalizeMenuPath(item.resource_path) : '';
    const codeKey = normalizeMenuPath(item.menu_code);
    if (pathKey && seen.has(pathKey)) continue;
    if (seen.has(codeKey)) continue;
    if (pathKey) seen.add(pathKey);
    seen.add(codeKey);
    next.push(item);
  }
  return next;
}

function collapseAssetsMenus(
  menus: SiteappMenuItemInput[],
  skipped: SkippedNavItem[],
  appName?: string,
): SiteappMenuItemInput[] {
  const first = menus.find((item) => item.menu_type !== 'directory') ?? menus[0];
  if (!first) return [];
  for (const item of menus) {
    if (item === first) continue;
    skipped.push({ label: item.menu_name || item.menu_code, reason: 'assets 应用只同步一个一级菜单' });
  }
  return [{
    ...first,
    parent_code: null,
    menu_name: first.menu_name.trim() || appName?.trim() || '工作台',
  }];
}

/** Scan nav arrays and Route declarations from any project sources (no fixed file list). */
export function scanSiteappMenusFromProjectSources(
  sources: string[],
  input: { pageType?: SiteAppPageType | string | null; appName?: string },
): SiteappMenuScanResult {
  const pageType = normalizeSiteAppPageType(input.pageType);
  const skipped: SkippedNavItem[] = [];
  const blocked = new Set<string>();
  let navMenus: SiteappMenuItemInput[] = [];
  let navSource: SiteappMenuScanResult['source'] = 'empty';

  for (const source of sources) {
    const nav = scanSiteappMenusFromNavSource(source, { pageType, appName: input.appName });
    skipped.push(...nav.skipped);
    for (const item of nav.skipped) {
      if (item.reason === 'developerOnly' && item.path) blocked.add(normalizeMenuPath(item.path));
    }
    if (nav.source === 'empty' || nav.menus.length === 0) continue;
    navMenus = mergeUniqueMenus(navMenus, nav.menus);
    if (navSource === 'empty') navSource = nav.source;
    else if (navSource !== nav.source) navSource = 'mixed';
  }

  const routeMenus: SiteappMenuItemInput[] = [];
  const seenRoutes = new Set<string>();
  const addRoute = (route: { path: string; component?: string; label?: string }) => {
    const key = normalizeMenuPath(route.path);
    if (!key || seenRoutes.has(key) || blocked.has(key) || !looksLikePagePath(key)) return;
    seenRoutes.add(key);
    routeMenus.push(leafMenu({
      key,
      label: route.label || humanizeRouteLabel(key, route.component),
      path: key,
    }, null));
  };
  for (const source of sources) {
    for (const route of extractJsxRouteEntries(source)) addRoute(route);
    for (const route of extractConfigRouteEntries(source)) addRoute(route);
  }

  let menus = mergeUniqueMenus(navMenus, routeMenus);
  let source: SiteappMenuScanResult['source'] = navSource;
  if (routeMenus.length > 0 && navSource === 'empty') source = 'routes';
  else if (routeMenus.length > 0 && navSource !== 'empty') source = 'mixed';

  if (pageType === 'assets') {
    menus = collapseAssetsMenus(menus, skipped, input.appName);
  }

  return { menus, skipped, source };
}
