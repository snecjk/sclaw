/**
 * memory-center-web 前端地址（iframe / 外链共用）。
 *
 * 测试：https://front-test.sto.cn/group/memory-center-web
 * 生产：https://front.sto.cn/group/memory-center-web
 *
 * - 新建：StoClaw 本地向导 `/workflow/new`
 * - 编辑：iframe 嵌入 `/workflows-workbench/{workflowId}`
 */
import { openExternalUrl } from '@/lib/preview-url';
import type { SsoEnvironment } from '@/stores/auth';
import { useAuthStore } from '@/stores/auth';

export const MC_WEB_TEST_BASE = 'https://front-test.sto.cn/group/memory-center-web';
export const MC_WEB_PROD_BASE = 'https://front.sto.cn/group/memory-center-web';
/** 本地跑 memory-center-web 时可在 .env.development.local 覆盖 */
export const MC_WEB_LOCAL_DEV_BASE = 'http://localhost:5173';

const MC_AUTH_SESSION_KEY = 'stoclaw-mc-web-auth';

const MC_WEB_BASE: Record<SsoEnvironment, string> = {
  'daily-external': MC_WEB_TEST_BASE,
  'pre-release': MC_WEB_TEST_BASE,
  'production-external': MC_WEB_PROD_BASE,
  'production-internal': MC_WEB_PROD_BASE,
  local: MC_WEB_TEST_BASE,
};

function resolveSsoEnvironment(explicit?: SsoEnvironment): SsoEnvironment {
  return explicit ?? useAuthStore.getState().ssoEnvironment;
}

function getMcWebPathname(base: string): string {
  try {
    return new URL(base).pathname.replace(/\/$/, '') || '';
  } catch {
    return base.replace(/\/$/, '');
  }
}

/** MC 识别 StoClaw 嵌入并隐藏顶栏/侧栏 */
export function appendMcEmbedQuery(url: string): string {
  const isAbsolute = /^https?:\/\//i.test(url);
  try {
    const parsed = new URL(url, isAbsolute ? undefined : 'https://stoclaw.local');
    parsed.searchParams.set('embedded', 'stoclaw');
    // Explicit host flag for MC pages that prefer query-based detection over UA sniffing.
    parsed.searchParams.set('inClaw', '1');
    return isAbsolute
      ? parsed.toString()
      : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

/** 同会话内 iframe 已写过 MC token 后，可跳过 SSO 回调 */
export function isMcWebAuthedInSession(): boolean {
  try {
    return sessionStorage.getItem(MC_AUTH_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

export function markMcWebAuthedInSession(): void {
  try {
    sessionStorage.setItem(MC_AUTH_SESSION_KEY, '1');
  } catch {
    // ignore
  }
}

/** MC Web 根路径 */
export function getMemoryCenterWebBase(ssoEnvironment?: SsoEnvironment): string {
  const override = import.meta.env.VITE_MEMORY_CENTER_WEB_ORIGIN as string | undefined;
  if (override?.trim()) {
    return override.trim().replace(/\/+$/, '');
  }

  const env = resolveSsoEnvironment(ssoEnvironment);
  return MC_WEB_BASE[env] ?? MC_WEB_PROD_BASE;
}

export function buildMemoryCenterDesignerRedirectPath(
  workflowId: string,
  ssoEnvironment?: SsoEnvironment,
): string {
  const pathname = getMcWebPathname(getMemoryCenterWebBase(ssoEnvironment));
  return appendMcEmbedQuery(
    `${pathname}/workflows-workbench/${encodeURIComponent(workflowId)}`,
  );
}

/** /sso/login/callback?stoToken=&redirect= — 写入 token 后一次跳转到目标页 */
export function buildMemoryCenterSsoCallbackUrl(
  stoToken: string,
  options?: { redirectPath?: string; ssoEnvironment?: SsoEnvironment },
): string {
  const base = getMemoryCenterWebBase(options?.ssoEnvironment);
  const params = new URLSearchParams({ stoToken });
  if (options?.redirectPath) {
    params.set('redirect', options.redirectPath);
  }
  params.set('embedded', 'stoclaw');
  return `${base}/sso/login/callback?${params.toString()}`;
}

/** /workflows-workbench/{workflowId} */
export function buildMemoryCenterWorkflowDesignerUrl(
  workflowId: string,
  ssoEnvironment?: SsoEnvironment,
): string {
  const base = getMemoryCenterWebBase(ssoEnvironment);
  return appendMcEmbedQuery(
    `${base}/workflows-workbench/${encodeURIComponent(workflowId)}`,
  );
}

/**
 * iframe 嵌入编辑器 URL：
 * - 同会话已登录 MC：直达编辑器（1 次加载）
 * - 首次：SSO 回调 + redirect 直达编辑器（MC 部署 redirect 后 1 次加载）
 */
export function buildMemoryCenterWorkflowDesignerEmbedUrl(
  workflowId: string,
  stoToken?: string,
  ssoEnvironment?: SsoEnvironment,
): string {
  const designerUrl = buildMemoryCenterWorkflowDesignerUrl(workflowId, ssoEnvironment);
  const token = stoToken?.trim();
  if (!token || isMcWebAuthedInSession()) {
    return designerUrl;
  }

  return buildMemoryCenterSsoCallbackUrl(token, {
    redirectPath: buildMemoryCenterDesignerRedirectPath(workflowId, ssoEnvironment),
    ssoEnvironment,
  });
}

/** 浏览器打开 */
export function openMemoryCenterWorkflowDesigner(workflowId: string, stoToken?: string): void {
  const token = stoToken?.trim() || useAuthStore.getState().user?.stoToken?.trim();
  const ssoEnvironment = useAuthStore.getState().ssoEnvironment;
  const url = token
    ? buildMemoryCenterSsoCallbackUrl(token, {
        redirectPath: buildMemoryCenterDesignerRedirectPath(workflowId, ssoEnvironment),
        ssoEnvironment,
      })
    : buildMemoryCenterWorkflowDesignerUrl(workflowId, ssoEnvironment);
  openExternalUrl(url);
}

/** /workflows-workbench/new?templateId= */
export function buildMemoryCenterWorkflowNewUrl(
  options?: { templateId?: string },
  ssoEnvironment?: SsoEnvironment,
): string {
  const base = getMemoryCenterWebBase(ssoEnvironment);
  const params = new URLSearchParams();
  if (options?.templateId && options.templateId !== 'blank') {
    params.set('templateId', options.templateId);
  }
  const query = params.toString();
  const path = query ? `${base}/workflows-workbench/new?${query}` : `${base}/workflows-workbench/new`;
  return appendMcEmbedQuery(path);
}

export function openMemoryCenterWorkflowNew(options?: { templateId?: string }): void {
  openExternalUrl(buildMemoryCenterWorkflowNewUrl(options));
}

/** /workflows-workbench 列表 */
export function buildMemoryCenterWorkflowListUrl(ssoEnvironment?: SsoEnvironment): string {
  return appendMcEmbedQuery(`${getMemoryCenterWebBase(ssoEnvironment)}/workflows-workbench`);
}

export function openMemoryCenterWorkflowList(): void {
  openExternalUrl(buildMemoryCenterWorkflowListUrl());
}
