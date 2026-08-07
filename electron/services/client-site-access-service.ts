/**
 * 客户端网点访问校验（memory-center /agent/v1/client-site-configs/{client}/access-check）
 */

import {
  CLIENT_SITE_CLIENT_CODE,
  requiresClientSiteAccessCheck,
  type ClientSiteAccessCheckResult,
} from '../../shared/client-site-access';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';
import { logger } from '../utils/logger';

const ACCESS_CHECK_PATH = `/agent/v1/client-site-configs/${encodeURIComponent(CLIENT_SITE_CLIENT_CODE)}/access-check`;
const FETCH_TIMEOUT_MS = 15_000;

export type CheckAccessOptions = {
  /** 传入时：非网点组织本地直接放行，不请求接口 */
  categoryCode?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseClientSiteAccessResponse(payload: unknown): ClientSiteAccessCheckResult {
  if (!isRecord(payload)) {
    return {
      allowed: false,
      errCode: 'MALFORMED',
      errMessage: '网点访问校验响应格式异常',
    };
  }

  const errCode = String(payload.errCode ?? '');
  const errMessage = String(payload.errMessage ?? payload.message ?? '');

  if (payload.success !== true) {
    return {
      allowed: false,
      errCode: errCode || 'ERROR',
      errMessage: errMessage || '网点访问校验失败',
    };
  }

  const data = isRecord(payload.data) ? payload.data : {};
  const allowed = data.allowed === true;

  return {
    allowed,
    clientCode: typeof data.client_code === 'string' ? data.client_code : CLIENT_SITE_CLIENT_CODE,
    categoryCode:
      typeof data.categoryCode === 'string' ? data.categoryCode : (data.categoryCode ?? null),
    companyCode:
      typeof data.companyCode === 'string' ? data.companyCode : (data.companyCode ?? null),
    errCode: '200',
    errMessage: allowed ? 'OK' : '所属组织不在客户端白名单内',
  };
}

export class ClientSiteAccessService {
  async checkAccess(
    stoToken: string,
    options?: CheckAccessOptions,
  ): Promise<ClientSiteAccessCheckResult> {
    const token = (stoToken || '').trim();
    if (!token) {
      return {
        allowed: false,
        errCode: '401',
        errMessage: '缺少 stoToken',
      };
    }

    // 仅当显式传入 categoryCode 且判定为非网点时跳过；未传则保守走接口
    if (
      options !== undefined &&
      'categoryCode' in options &&
      !requiresClientSiteAccessCheck(options.categoryCode)
    ) {
      const categoryCode = options.categoryCode ?? null;
      logger.info(
        `[ClientSiteAccessService] skip access-check for non-site category=${categoryCode ?? ''}`,
      );
      return {
        allowed: true,
        clientCode: CLIENT_SITE_CLIENT_CODE,
        categoryCode,
        errCode: '200',
        errMessage: 'OK',
      };
    }

    const baseUrl = await resolveStoBaseUrl();
    const url = `${baseUrl}${ACCESS_CHECK_PATH}`;
    logger.info(`[ClientSiteAccessService] checkAccess: ${url}`);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: buildStoMemoryCenterAuthHeaders(token),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        logger.warn(
          `[ClientSiteAccessService] HTTP ${response.status}: ${JSON.stringify(payload)}`,
        );
        return {
          allowed: false,
          errCode: String(response.status),
          errMessage: '网点访问校验请求失败',
        };
      }

      return parseClientSiteAccessResponse(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[ClientSiteAccessService] checkAccess failed: ${message}`);
      return {
        allowed: false,
        errCode: 'NETWORK',
        errMessage: '网点访问校验不可用，请稍后重试',
      };
    }
  }
}

let instance: ClientSiteAccessService | null = null;

export function getClientSiteAccessService(): ClientSiteAccessService {
  if (!instance) {
    instance = new ClientSiteAccessService();
  }
  return instance;
}
