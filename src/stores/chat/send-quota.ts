import { checkDailyTokenQuota, formatQuotaExceededMessage } from './runtime-send-actions';
import { setRuntimePatch } from './runtime-controller';
import type { ChatSet } from './store-api';

export async function ensureDailyTokenQuota(input: {
  set: ChatSet;
  sessionKey: string;
  toNumberIfFinite: (value: unknown) => number | undefined;
}): Promise<boolean> {
  const { sessionKey, set, toNumberIfFinite } = input;
  const quotaCheck = await checkDailyTokenQuota();
  if (quotaCheck) {
    set({
      dailyTokenQuotaStatus: {
        allowed: quotaCheck.allowed,
        usedToday: toNumberIfFinite(quotaCheck.used_today),
        limit: toNumberIfFinite(quotaCheck.limit),
        checkedAt: new Date().toISOString(),
      },
    });
  }
  if (!quotaCheck || quotaCheck.allowed !== false) {
    return true;
  }

  setRuntimePatch(set, sessionKey, {
    sending: false,
    error: formatQuotaExceededMessage(quotaCheck.used_today, quotaCheck.limit),
  });
  return false;
}
