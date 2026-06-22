/**
 * 上报 Token 额度扩容申请记录到 memory-center
 */

import { getStoToken } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';
import { logger } from '../utils/logger';
import type { TokenQuotaExpansionRecordPayload } from '../../shared/token-quota-expansion-record';

const EXPANSION_RECORD_PATH = '/agent/v1/token-quota/expansion-records';

export function generateApplyCode(): string {
  const random = Math.random().toString(16).slice(2, 10);
  return `exp_${Date.now()}_${random}`;
}

export async function reportTokenQuotaExpansionRecord(
  payload: TokenQuotaExpansionRecordPayload,
): Promise<void> {
  const token = await getStoToken();
  if (!token) {
    logger.warn('[ExpansionRecord] skip report: no stoToken');
    return;
  }

  const baseUrl = await resolveStoBaseUrl();
  const url = `http://127.0.0.1:7001${EXPANSION_RECORD_PATH}`;
  logger.info(`[ExpansionRecord] reporting to ${url} apply_code=${payload.apply_code} status=${payload.status}`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...buildStoMemoryCenterAuthHeaders(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logger.warn(`[ExpansionRecord] report failed (${response.status}): ${text}`);
      return;
    }

    logger.info(`[ExpansionRecord] report success apply_code=${payload.apply_code}`);
  } catch (err) {
    logger.warn('[ExpansionRecord] report error:', err);
  }
}
