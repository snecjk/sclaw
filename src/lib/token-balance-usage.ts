export interface TokenBalanceUsage {
  available: number;
  usedPercent: number;
  remainingPercent: number;
}

export function calculateTokenBalanceUsage(
  spend: number | null | undefined,
  maxBudget: number | null | undefined,
): TokenBalanceUsage | null {
  if (typeof maxBudget !== 'number' || !Number.isFinite(maxBudget) || maxBudget <= 0) {
    return null;
  }

  const normalizedSpend = typeof spend === 'number' && Number.isFinite(spend)
    ? Math.min(maxBudget, Math.max(0, spend))
    : 0;
  const usedPercent = Math.round((normalizedSpend / maxBudget) * 100);

  return {
    available: Math.max(0, maxBudget - normalizedSpend),
    usedPercent,
    remainingPercent: 100 - usedPercent,
  };
}
