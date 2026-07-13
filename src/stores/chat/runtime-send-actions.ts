import { hostApiFetch } from '@/lib/host-api';

type TokenQuotaCheckResult = {
  success: boolean;
  data?: {
    allowed?: boolean;
    used_today?: number;
    limit?: number;
  };
};

export type DailyTokenQuotaState = {
  allowed?: boolean;
  used_today?: number;
  limit?: number;
};

export async function checkDailyTokenQuota(): Promise<DailyTokenQuotaState | null> {
  try {
    const quotaCheck = await hostApiFetch<TokenQuotaCheckResult>('/api/token-quota/check');
    if (!quotaCheck?.success || !quotaCheck.data) return null;
    return quotaCheck.data;
  } catch {
    return null;
  }
}

export function formatQuotaExceededMessage(usedToday?: number, limit?: number): string {
  if (typeof usedToday === 'number' && typeof limit === 'number') {
    return `Daily token quota exceeded (${usedToday}/${limit}).`;
  }
  return 'Daily token quota exceeded.';
}
