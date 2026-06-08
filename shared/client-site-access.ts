/** memory-center 客户端网点访问校验使用的客户端编码（须与字典 client_site_client 一致） */
export const CLIENT_SITE_CLIENT_CODE = 'StoClaw';

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
