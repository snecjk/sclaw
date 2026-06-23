import type { IncomingMessage, ServerResponse } from 'http';

import type { HostApiContext } from '../context';
import { sendJson, parseJsonBody } from '../route-utils';
import { getStoTokenQuotaService } from '../../services/sto-token-quota-service';
import { getUserSkDetail, getUserTokenQuotaTiers } from '../../services/user-sk-service';
import { resolveUserType } from '../../services/sto-sk-strategy';
import { applyHqTokenQuotaExpansion, StoTokenQuotaExpansionApplyError } from '../../services/sto-token-quota-expansion-apply-service';
import { applySiteTokenQuotaExpansionViaMemoryCenter, StoSiteMemoryApiError } from '../../services/sto-site-memory-api-service';
import { validateHqExpansionBody, validateSiteExpansionBody } from '../../services/token-quota-expansion-validation';
import { getAuthState } from '../../utils/auth-store';
import { logger } from '../../utils/logger';
import type { TokenQuotaTierItem, TokenQuotaTierQueryResult } from '../../../shared/sto-token-quota-tier';

function resolveTokenQuotaStatusCode(error: unknown): number {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const statusCode = Number((error as { statusCode?: unknown }).statusCode);
    if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600) {
      return statusCode;
    }
  }

  const message = String(error);
  if (/未登录|stoToken|unauthori[sz]ed/i.test(message)) {
    return 401;
  }
  if (/forbidden|403/i.test(message)) {
    return 403;
  }
  return 500;
}

interface ExpansionRequestBody {
  tokenId?: string;
  quotaAmount?: number;
  clientEventId?: string;
  tier?: TokenQuotaTierItem;
  tierContext?: TokenQuotaTierQueryResult | null;
}

export async function handleTokenQuotaRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/token-quota/check' && req.method === 'GET') {
    // In development mode, bypass the remote quota check so local testing
    // isn't blocked by backend token limits.
    const isDev = (import.meta.env.VITE_APP_ENV as string) === 'development';
    if (isDev) {
      sendJson(res, 200, { success: true, data: { allowed: true } });
      return true;
    }

    try {
      const service = getStoTokenQuotaService();
      const result = await service.checkTokenQuota();
      sendJson(res, 200, result);
    } catch (error) {
      logger.error('[token-quota] Check route error:', error);
      const statusCode = resolveTokenQuotaStatusCode(error);
      sendJson(res, statusCode, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/token-balance' && req.method === 'GET') {
    try {
      const detail = await getUserSkDetail();
      if (!detail) {
        sendJson(res, 200, { tokenId: '', spend: 0, maxBudget: 0 });
        return true;
      }
      sendJson(res, 200, detail);
    } catch (error) {
      logger.error('[token-quota] Token balance route error:', error);
      sendJson(res, 500, { error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/token-quota/tiers' && req.method === 'GET') {
    try {
      const queryTokenId = url.searchParams.get('tokenId')?.trim() ?? '';
      let tokenId = queryTokenId;
      if (!tokenId) {
        const detail = await getUserSkDetail();
        tokenId = detail?.tokenId ?? '';
      }
      if (!tokenId) {
        sendJson(res, 200, null);
        return true;
      }
      const result = await getUserTokenQuotaTiers(tokenId);
      sendJson(res, 200, result);
    } catch (error) {
      logger.error('[token-quota] Tiers route error:', error);
      sendJson(res, 500, { error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/token-quota/expansion' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<ExpansionRequestBody>(req);
      const { user } = await getAuthState();
      const userType = await resolveUserType(user);

      if (userType === 'hq') {
        const validationError = validateHqExpansionBody(body);
        if (validationError) {
          sendJson(res, 400, { error: validationError });
          return true;
        }
        try {
          await applyHqTokenQuotaExpansion(body);
          sendJson(res, 200, { success: true });
        } catch (error) {
          if (error instanceof StoTokenQuotaExpansionApplyError) {
            sendJson(res, error.statusCode, { error: error.message });
            return true;
          }
          throw error;
        }
        return true;
      }

      // 网点：经 memory-center 代理 personalBuy + 审计落库
      const siteValidationError = validateSiteExpansionBody(body);
      if (siteValidationError) {
        sendJson(res, 400, { error: siteValidationError });
        return true;
      }
      const tokenId = body.tokenId!.trim();
      const quotaAmount = Number(body.quotaAmount) || 0;
      try {
        await applySiteTokenQuotaExpansionViaMemoryCenter({
          tokenId,
          quotaAmount,
          clientEventId: body.clientEventId,
        });
        sendJson(res, 200, { success: true });
      } catch (error) {
        if (error instanceof StoSiteMemoryApiError) {
          sendJson(res, error.statusCode, { error: error.message });
          return true;
        }
        throw error;
      }
      return true;
    } catch (error) {
      logger.error('[token-quota] Expansion route error:', error);
      sendJson(res, 500, { error: String(error) });
    }
    return true;
  }

  return false;
}
