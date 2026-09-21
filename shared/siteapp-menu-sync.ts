import { normalizeSiteAppPageType, type SiteAppPageType } from './site-app-catalog';

export interface SiteappMenuItemInput {
  menu_code: string;
  parent_code: string | null;
  menu_name: string;
  /** Cloud API only accepts `directory` | `page`. Legacy `menu` is normalized to `page`. */
  menu_type: string;
  resource_path?: string | null;
}

export function normalizeSiteappMenuType(menuType: string | null | undefined): 'directory' | 'page' {
  return menuType?.trim() === 'directory' ? 'directory' : 'page';
}

export function normalizeSiteappMenuItem(item: SiteappMenuItemInput): SiteappMenuItemInput {
  const resourcePath = item.resource_path?.trim() || '';
  return {
    menu_code: item.menu_code.trim(),
    parent_code: item.parent_code?.trim() || null,
    menu_name: item.menu_name.trim() || item.menu_code.trim(),
    menu_type: normalizeSiteappMenuType(item.menu_type),
    ...(resourcePath ? { resource_path: resourcePath } : {}),
  };
}

/** Defaults for `sai-cli siteapp menu sync` apply, also used by HTTP menus/replace. */
export const SITEAPP_MENU_SYNC_APPLY_DEFAULTS = {
  mode: 'apply',
  confirm: true,
  allow_empty: false,
  skip_preview: true,
} as const;

export function buildSiteappMenuSyncParams(input: {
  appCode: string;
  menus: SiteappMenuItemInput[];
}): Record<string, unknown> {
  const appCode = input.appCode.trim();
  if (!appCode) throw new Error('缺少 app_code');
  return {
    app_code: appCode,
    ...SITEAPP_MENU_SYNC_APPLY_DEFAULTS,
    menus: input.menus.map(normalizeSiteappMenuItem),
  };
}

export function formatSiteappMenuSyncCliExample(appCode?: string): string {
  const code = appCode?.trim() || '<app_code>';
  const params = JSON.stringify({
    app_code: code,
    ...SITEAPP_MENU_SYNC_APPLY_DEFAULTS,
  }).replace(/\}$/, ',"menus":[...]}');
  return `sai-cli siteapp menu sync --params '${params}' -f json`;
}

export function buildPostPublishMenuSyncPrompt(input: {
  appCode?: string;
  appName?: string;
  pageType?: SiteAppPageType | string | null;
  env?: string;
  trigger?: 'deploy-success' | 'manual';
}): string {
  const appCode = input.appCode?.trim() || '';
  const appName = input.appName?.trim() || '当前应用';
  const pageType = normalizeSiteAppPageType(input.pageType);
  const env = input.env?.trim() || 'daily';
  const structureRule = pageType === 'assets'
    ? '本应用是 **assets（托管应用）**：云端菜单只同步 **一个一级菜单**（`parent_code` 为 null，`menu_type` 为 directory 或 page）。不要拆二级。'
    : '本应用是 **site（独立站点）**：按用户现有导航/路由整理菜单，只保留 **一级 + 二级**。一级目录用 `menu_type: "directory"`（`parent_code: null`），页面用 `menu_type: "page"`。不要传 `menu`，不要做三级。';

  const appCodeLine = appCode
    ? `\`app_code\` 必须使用 \`${appCode}\`，不要编造。`
    : '先从 `.sto/workspace.json` 读取 `appCode`，不要编造。';
  const opener = input.trigger === 'manual'
    ? `请扫描「${appName}」的项目路由，整理云端菜单，并询问我是否同步。`
    : `「${appName}」已经发布到 ${env}。请扫描本项目路由，整理云端菜单，并询问我是否同步。`;

  return [
    opener,
    '',
    structureRule,
    appCodeLine,
    '',
    '扫描项目源码中的导航、Route，以及带 permission/auth 的路由表。运行时按权限隐藏的页面也要列入，避免尚未授权时漏同步。忽略 404、index 重定向、以及 `developerOnly` 的开发页。',
    '',
    '先用中文列出将要同步的菜单树（编码、名称、父子关系），然后明确问我：「是否把以上菜单同步到云端？」',
    '我同意之前，不要执行 apply。',
    '我同意之后调用：',
    '',
    '```bash',
    formatSiteappMenuSyncCliExample(appCode),
    '```',
    '',
    '可先对照现有菜单：',
    '',
    '```bash',
    `sai-cli siteapp menu list --params '{"app_code":"${appCode || '<app_code>'}"}' -f json`,
    '```',
  ].join('\n');
}
