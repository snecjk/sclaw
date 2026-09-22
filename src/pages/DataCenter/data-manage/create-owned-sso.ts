/**
 * 数据管理 preview 嵌入页。
 *
 * preview 业务接口读 localStorage `auth.token` → 请求头 `x-bi-token`。
 * Host 已缓存该 token（列表页换票）：有效则直达目标页并注入 localStorage。
 * 仅当 Host 换票失败时，才打开 sto-finance-bi 免登页。
 */
import {
  appendSkipLoginReturnUrl,
  fetchAppPlazaSkipLoginLink,
} from '@/lib/app-plaza-api';
import {
  fetchFinanceBiPreviewEmbedAuth,
  fetchFinanceBiPreviewEmbedBridge,
  type FinanceBiPreviewEmbedAuth,
} from '@/lib/finance-bi-api';
import { STO_FINANCE_BI_SYSTEM_CODE } from '../../../../shared/finance-bi-config';
import { CREATE_OWNED_DATASOURCE_URL } from './constants';

export type DataManagePreviewEmbedTarget = {
  url: string;
  injectAuth?: FinanceBiPreviewEmbedAuth;
  preloadUrl?: string;
};

export type CreateOwnedDatasourceEmbedTarget = DataManagePreviewEmbedTarget;

export async function resolveDataManagePreviewEmbed(
  previewUrl: string,
): Promise<DataManagePreviewEmbedTarget> {
  try {
    const injectAuth = await fetchFinanceBiPreviewEmbedAuth();
    return { url: previewUrl, injectAuth };
  } catch {
    const [skipLoginUrl, preloadUrl] = await Promise.all([
      fetchAppPlazaSkipLoginLink(STO_FINANCE_BI_SYSTEM_CODE),
      fetchFinanceBiPreviewEmbedBridge(),
    ]);
    return {
      url: appendSkipLoginReturnUrl(skipLoginUrl, previewUrl) || previewUrl,
      preloadUrl,
    };
  }
}

export async function resolveCreateOwnedDatasourceEmbed(): Promise<DataManagePreviewEmbedTarget> {
  return resolveDataManagePreviewEmbed(CREATE_OWNED_DATASOURCE_URL);
}

/** 对齐 preview `saveAuthToLocalStorage` + `saveStoBiUserInfo` */
export function buildPreviewAuthInjectScript(auth: FinanceBiPreviewEmbedAuth): string {
  const payload = {
    token: auth.token,
    sid: auth.sid ?? '',
    userInfo: JSON.stringify(auth.userInfo ?? {}),
    stoBiUserInfo: JSON.stringify(auth.stoBiUserInfo ?? {}),
    exp: String(auth.exp || ''),
    time: String(auth.time || Date.now()),
  };
  return `(() => {
    try {
      localStorage.setItem('auth.token', ${JSON.stringify(payload.token)});
      localStorage.setItem('auth.userInfo', ${JSON.stringify(payload.userInfo)});
      localStorage.setItem('stoBiUserInfo', ${JSON.stringify(payload.stoBiUserInfo)});
      localStorage.setItem('auth.exp', ${JSON.stringify(payload.exp)});
      localStorage.setItem('auth.time', ${JSON.stringify(payload.time)});
      ${payload.sid ? `localStorage.setItem('auth.sid', ${JSON.stringify(payload.sid)});` : ''}
    } catch (error) {}
  })()`;
}
