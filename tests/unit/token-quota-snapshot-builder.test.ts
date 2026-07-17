import { describe, expect, it } from 'vitest';

import { buildBalanceSnapshot, buildHqPackageSnapshot } from '@electron/services/token-quota-snapshot-builder';

describe('token-quota-snapshot-builder', () => {
  it('builds balance snapshot with normalized fields', () => {
    const snapshot = buildBalanceSnapshot('hq', {
      tokenId: 'tk_1',
      spend: 20,
      maxBudget: 100,
    });
    expect(snapshot.schema).toBe('sto.claw.balance_snapshot/v1');
    expect(snapshot.normalized.total_quota).toBe(100);
    expect(snapshot.normalized.used_quota).toBe(20);
    expect(snapshot.normalized.remaining_quota).toBe(80);
  });

  it('builds hq package snapshot envelope', () => {
    const snapshot = buildHqPackageSnapshot(
      {
        quotaAmount: 500,
        tierName: '标准套餐',
        needApproval: false,
        level: 2,
        approverDesc: null,
        isDefault: false,
        applied: false,
        children: null,
      },
      500,
      {
        tierList: [],
        currentTier: '基础档',
        currentQuota: 300,
        totalExpandedQuota: 50,
      },
    );
    expect(snapshot.schema).toBe('sto.claw.package_snapshot/v1');
    expect(snapshot.apply_semantics).toBe('target_quota');
    expect(snapshot.selected.kind).toBe('tier');
    expect(snapshot.selected.tier_name).toBe('标准套餐');
  });
});
