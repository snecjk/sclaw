import { describe, expect, it } from 'vitest';
import {
  buildHqExpansionApplyPayload,
  validateHqExpansionBody,
} from '@electron/services/token-quota-expansion-validation';
import type { TokenQuotaTierItem, TokenQuotaTierQueryResult } from '../../shared/sto-token-quota-tier';

const tier: TokenQuotaTierItem = {
  level: 2,
  tierName: '标准套餐',
  quotaAmount: 500,
  needApproval: false,
  approverDesc: null,
  isDefault: false,
  applied: false,
  children: null,
};

const tierContext: TokenQuotaTierQueryResult = {
  tierList: [tier],
  currentTier: '基础档',
  currentQuota: 300,
  totalExpandedQuota: 50,
};

describe('validateHqExpansionBody', () => {
  it('accepts a complete hq payload', () => {
    expect(
      validateHqExpansionBody({
        tokenId: 'tk_1',
        quotaAmount: 500,
        tier,
        tierContext,
      }),
    ).toBeNull();
  });

  it('rejects missing tierContext', () => {
    expect(
      validateHqExpansionBody({
        tokenId: 'tk_1',
        quotaAmount: 500,
        tier,
      }),
    ).toBe('tierContext is required');
  });

  it('rejects tier quota mismatch', () => {
    expect(
      validateHqExpansionBody({
        tokenId: 'tk_1',
        quotaAmount: 400,
        tier,
        tierContext,
      }),
    ).toBe('tier.quotaAmount mismatch');
  });
});

describe('buildHqExpansionApplyPayload', () => {
  it('maps camelCase tier fields to snake_case', () => {
    const payload = buildHqExpansionApplyPayload({
      tokenId: 'tk_1',
      quotaAmount: 500,
      tier,
      tierContext,
      clientEventId: 'evt_1',
    });
    expect(payload.token_id).toBe('tk_1');
    expect(payload.tier).toMatchObject({
      tier_name: '标准套餐',
      quota_amount: 500,
      level: 2,
    });
    expect(payload.tier_context).toMatchObject({
      current_quota: 300,
      tier_list: [expect.objectContaining({ tier_name: '标准套餐' })],
    });
  });
});
