import { describe, expect, it } from 'vitest';
import { calculateTokenBalanceUsage } from '@/lib/token-balance-usage';

describe('calculateTokenBalanceUsage', () => {
  it('calculates rounded used and remaining percentages', () => {
    expect(calculateTokenBalanceUsage(25.4, 80)).toEqual({
      available: 54.6,
      usedPercent: 32,
      remainingPercent: 68,
    });
  });

  it('clamps invalid spend values into the quota range', () => {
    expect(calculateTokenBalanceUsage(-10, 100)?.usedPercent).toBe(0);
    expect(calculateTokenBalanceUsage(120, 100)).toEqual({
      available: 0,
      usedPercent: 100,
      remainingPercent: 0,
    });
    expect(calculateTokenBalanceUsage(Number.NaN, 100)?.usedPercent).toBe(0);
  });

  it('returns null when a usable total quota is unavailable', () => {
    expect(calculateTokenBalanceUsage(10, 0)).toBeNull();
    expect(calculateTokenBalanceUsage(10, Number.NaN)).toBeNull();
    expect(calculateTokenBalanceUsage(10, undefined)).toBeNull();
  });
});
