/**
 * 组装 Token 额度扩容申请快照（package / balance）
 */

import type { SsoUserInfo } from '../utils/auth-store';
import type { TokenQuotaTierItem, TokenQuotaTierQueryResult } from '../../shared/sto-token-quota-tier';
import type {
  BalanceSnapshotV1,
  ExpansionUserType,
  PackageSnapshotV1,
} from '../../shared/token-quota-expansion-record';

export function buildBalanceSnapshot(
  userType: ExpansionUserType,
  detail: { tokenId: string; spend: number; maxBudget: number },
): BalanceSnapshotV1 {
  const total = detail.maxBudget ?? 0;
  const used = detail.spend ?? 0;
  return {
    schema: 'sto.claw.balance_snapshot/v1',
    user_type: userType,
    normalized: {
      total_quota: total,
      used_quota: used,
      remaining_quota: Math.max(0, total - used),
    },
    raw: {
      spend: detail.spend,
      max_budget: detail.maxBudget,
      token_id: detail.tokenId,
    },
  };
}

export function buildHqPackageSnapshot(
  tier: TokenQuotaTierItem,
  quotaAmount: number,
  tierContext?: TokenQuotaTierQueryResult | null,
): PackageSnapshotV1 {
  return {
    schema: 'sto.claw.package_snapshot/v1',
    user_type: 'hq',
    apply_semantics: 'target_quota',
    tenant: { tenant_code: 'enterprise-Intelligence' },
    selected: {
      kind: 'tier',
      level: tier.level,
      tier_name: tier.tierName,
      quota_amount: tier.quotaAmount ?? quotaAmount,
      need_approval: tier.needApproval,
      raw: tier,
    },
    context: tierContext
      ? {
          current_tier: tierContext.currentTier,
          current_quota: tierContext.currentQuota,
          total_expanded_quota: tierContext.totalExpandedQuota,
          tier_list: tierContext.tierList,
        }
      : undefined,
    raw: { source: 'queryTokenQuotaTier' },
  };
}

export function buildSitePackageSnapshot(
  user: SsoUserInfo,
  quotaAmount: number,
  tier?: TokenQuotaTierItem,
  tierContext?: TokenQuotaTierQueryResult | null,
): PackageSnapshotV1 {
  const tenantCode = user.companyCode?.trim() || user.code?.trim() || '';
  return {
    schema: 'sto.claw.package_snapshot/v1',
    user_type: 'site',
    apply_semantics: 'increment',
    tenant: {
      tenant_code: tenantCode,
      company_code: user.companyCode?.trim() || undefined,
    },
    selected: {
      kind: tier ? 'tier' : 'custom',
      tier_name: tier?.tierName,
      quota_amount: tier?.quotaAmount ?? quotaAmount,
      level: tier?.level,
      need_approval: tier?.needApproval,
      raw: tier ?? { quota_amount: quotaAmount },
    },
    context: tierContext
      ? {
          current_tier: tierContext.currentTier,
          current_quota: tierContext.currentQuota,
          total_expanded_quota: tierContext.totalExpandedQuota,
        }
      : undefined,
    raw: { source: 'personalBuy' },
  };
}

export function buildPackageSnapshot(
  userType: ExpansionUserType,
  user: SsoUserInfo,
  quotaAmount: number,
  tier?: TokenQuotaTierItem,
  tierContext?: TokenQuotaTierQueryResult | null,
): PackageSnapshotV1 {
  if (userType === 'site') {
    return buildSitePackageSnapshot(user, quotaAmount, tier, tierContext);
  }
  if (tier) {
    return buildHqPackageSnapshot(tier, quotaAmount, tierContext);
  }
  return {
    schema: 'sto.claw.package_snapshot/v1',
    user_type: 'hq',
    apply_semantics: 'target_quota',
    tenant: { tenant_code: 'enterprise-Intelligence' },
    selected: {
      kind: 'custom',
      quota_amount: quotaAmount,
      raw: { quota_amount: quotaAmount },
    },
    raw: { source: 'expand_quota' },
  };
}

export function buildUserExtra(user: SsoUserInfo): Record<string, unknown> {
  return {
    category_code: user.categoryCode,
    company_code: user.companyCode,
    company_name: user.companyName,
    department_code: user.departmentCode,
    department_name: user.departmentName,
    sso_user_id: user.id,
  };
}
