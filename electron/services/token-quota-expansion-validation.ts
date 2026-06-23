/**
 * 非网点额度扩容申请参数校验（与 memory-center 契约对齐）
 */

import type { TokenQuotaTierItem, TokenQuotaTierQueryResult } from '../../shared/sto-token-quota-tier';

export interface HqExpansionRequestBody {
  tokenId?: string;
  quotaAmount?: number;
  clientEventId?: string;
  tier?: TokenQuotaTierItem;
  tierContext?: TokenQuotaTierQueryResult | null;
}

export function validateHqExpansionBody(body: HqExpansionRequestBody): string | null {
  const tokenId = body.tokenId?.trim() || '';
  if (!tokenId) return 'tokenId is required';

  const quotaAmount = Number(body.quotaAmount) || 0;
  if (quotaAmount <= 0) return 'quotaAmount must be positive';

  const tier = body.tier;
  if (!tier) return 'tier is required';
  if (tier.applied) return 'tier already applied';
  if (tier.level == null) return 'tier.level is required';
  if (tier.quotaAmount == null || tier.quotaAmount <= 0) return 'tier.quotaAmount is required';
  if (Math.abs(tier.quotaAmount - quotaAmount) > 0.01) return 'tier.quotaAmount mismatch';

  const tierContext = body.tierContext;
  if (!tierContext) return 'tierContext is required';
  if (!tierContext.tierList?.length) return 'tierContext.tierList is required';
  if (tierContext.currentQuota == null) return 'tierContext.currentQuota is required';

  return null;
}

function toSnakeTier(tier: TokenQuotaTierItem): Record<string, unknown> {
  return {
    quota_amount: tier.quotaAmount,
    tier_name: tier.tierName,
    need_approval: tier.needApproval,
    level: tier.level,
    approver_desc: tier.approverDesc,
    is_default: tier.isDefault,
    applied: tier.applied,
    children: tier.children?.map(toSnakeTier) ?? null,
  };
}

export function buildHqExpansionApplyPayload(body: HqExpansionRequestBody): Record<string, unknown> {
  const tier = body.tier!;
  const tierContext = body.tierContext!;
  return {
    token_id: body.tokenId!.trim(),
    quota_amount: Number(body.quotaAmount),
    tier: toSnakeTier(tier),
    tier_context: {
      tier_list: tierContext.tierList.map(toSnakeTier),
      current_tier: tierContext.currentTier,
      current_quota: tierContext.currentQuota,
      total_expanded_quota: tierContext.totalExpandedQuota ?? 0,
    },
    client_event_id: body.clientEventId?.trim() || undefined,
  };
}
