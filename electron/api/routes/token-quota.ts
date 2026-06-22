import type { IncomingMessage, ServerResponse } from 'http';

import type { HostApiContext } from '../context';
import { sendJson } from '../route-utils';
import { getStoTokenQuotaService } from '../../services/sto-token-quota-service';
import {
  generateApplyCode,
  reportTokenQuotaExpansionRecord,
} from '../../services/sto-token-quota-expansion-record-service';
import {
  buildBalanceSnapshot,
  buildPackageSnapshot,
  buildUserExtra,
} from '../../services/token-quota-snapshot-builder';
import { getUserSkDetail, expandUserSkQuota, getUserTokenQuotaTiers } from '../../services/user-sk-service';
import { resolveUserType } from '../../services/sto-sk-strategy';
import { getAuthState } from '../../utils/auth-store';
import { parseJsonBody } from '../route-utils';
import { logger } from '../../utils/logger';
import type { TokenQuotaTierItem, TokenQuotaTierQueryResult } from '../../../shared/sto-token-quota-tier';
import type {
  ExpansionRecordStatus,
  TokenQuotaExpansionRecordPayload,
} from '../../../shared/token-quota-expansion-record';

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

function resolveExpansionStatus(
  result: { success: boolean; message?: string },
  hadError: boolean,
): ExpansionRecordStatus {
  if (hadError && !result.success) return 'error';
  return result.success ? 'succeeded' : 'failed';
}

function resolveClientPlatform(): string | undefined {
  try {
    return process.platform;
  } catch {
    return undefined;
  }
}

function resolveClientVersion(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('../../../package.json') as { version?: string };
    return pkg.version;
  } catch {
    return undefined;
  }
}

async function reportExpansionAfterApply(
  body: ExpansionRequestBody,
  quotaAmount: number,
  expansionResult: Awaited<ReturnType<typeof expandUserSkQuota>>,
  applyCode: string,
  balanceDetail: { tokenId: string; spend: number; maxBudget: number } | null,
  hadTransportError: boolean,
): Promise<void> {
  const { user } = await getAuthState();
  if (!user) return;

  const userType = await resolveUserType(user);
  if (!userType) return;

  const tokenId = body.tokenId?.trim() || balanceDetail?.tokenId || '';
  if (!tokenId) return;

  const detailForSnapshot = balanceDetail ?? {
    tokenId,
    spend: 0,
    maxBudget: 0,
  };

  const packageSnapshot = buildPackageSnapshot(
    userType,
    user,
    quotaAmount,
    body.tier,
    body.tierContext,
  );
  const balanceSnapshot = buildBalanceSnapshot(userType, detailForSnapshot);
  const status = resolveExpansionStatus(expansionResult, hadTransportError);

  const record: TokenQuotaExpansionRecordPayload = {
    apply_code: applyCode,
    emp_code: user.empCode?.trim() || undefined,
    user_code: user.code?.trim() || undefined,
    user_name: user.realName?.trim() || undefined,
    user_type: userType,
    token_id: tokenId,
    apply_action: 'expand_quota',
    quota_amount: quotaAmount,
    quota_unit: 'CNY',
    status,
    gateway_status: expansionResult.gatewayStatus,
    gateway_message: expansionResult.message,
    client_app: 'sto-claw',
    client_version: resolveClientVersion(),
    client_platform: resolveClientPlatform(),
    client_event_id: body.clientEventId?.trim() || undefined,
    applied_at: new Date().toISOString(),
    package_snapshot: packageSnapshot,
    balance_snapshot: balanceSnapshot,
    gateway_payload: expansionResult.gatewayPayload,
    extra: buildUserExtra(user),
  };

  await reportTokenQuotaExpansionRecord(record);
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
      const tokenId = body.tokenId?.trim() || '';
      const quotaAmount = Number(body.quotaAmount) || 0;
      if (!tokenId || quotaAmount <= 0) {
        sendJson(res, 400, { error: 'tokenId and quotaAmount are required' });
        return true;
      }

      const applyCode = generateApplyCode();
      const balanceDetail = await getUserSkDetail();

      let expansionResult: Awaited<ReturnType<typeof expandUserSkQuota>>;
      let hadTransportError = false;
      try {
        expansionResult = await expandUserSkQuota(tokenId, quotaAmount);
      } catch (err) {
        hadTransportError = true;
        expansionResult = {
          success: false,
          message: String(err),
        };
      }

      void reportExpansionAfterApply(
        { ...body, tokenId },
        quotaAmount,
        expansionResult,
        applyCode,
        balanceDetail,
        hadTransportError,
      ).catch((err) => {
        logger.warn('[token-quota] expansion record report failed:', err);
      });

      if (!expansionResult.success) {
        sendJson(res, 400, { error: expansionResult.message || 'Expansion failed' });
        return true;
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      logger.error('[token-quota] Expansion route error:', error);
      sendJson(res, 500, { error: String(error) });
    }
    return true;
  }

  return false;
}
