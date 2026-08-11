/** memory-center 客户端网点访问校验使用的客户端编码（须与字典 client_site_client 一致） */
export const CLIENT_SITE_CLIENT_CODE = 'StoClaw';

/**
 * 需走白名单 access-check 的网点组织类别（对齐 memory-center
 * CLIENT_SITE_ACCESS_CHECK_CATEGORIES 默认值）。
 */
export const CLIENT_SITE_ACCESS_CHECK_CATEGORIES = [
  '独立网点',
  '承包区',
  '网点部门',
] as const;

/**
 * 仅网点级组织需要调用白名单接口；空/非网点类别与后端一致，视为无需校验。
 */
export function requiresClientSiteAccessCheck(
  categoryCode: string | null | undefined,
): boolean {
  const code = (categoryCode ?? '').trim();
  if (!code) return false;
  return (CLIENT_SITE_ACCESS_CHECK_CATEGORIES as readonly string[]).includes(code);
}

export interface ClientSiteAccessCheckData {
  client_code?: string;
  allowed?: boolean;
  categoryCode?: string | null;
  companyCode?: string | null;
}

export interface ClientSiteAccessCheckResult {
  allowed: boolean;
  clientCode?: string;
  categoryCode?: string | null;
  companyCode?: string | null;
  errCode?: string;
  errMessage?: string;
}
