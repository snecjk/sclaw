import { normalizeSiteAppPageType, type SiteAppPageType } from './site-app-catalog';
import type { SiteappMenuItemInput } from './siteapp-menu-sync';

export interface SkippedNavItem {
  label: string;
  reason: string;
}

export interface SiteappMenuScanResult {
  menus: SiteappMenuItemInput[];
  skipped: SkippedNavItem[];
  source: 'top-nav' | 'side-nav' | 'empty';
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
      skipped.push({ label: child.label || child.key, reason: 'developerOnly' });
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
      skipped.push({ label: group.label || group.key, reason: 'developerOnly' });
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
