/**
 * Token 额度扩容申请记录（memory-center token_quota_expansion_records）
 */

import type { TokenQuotaTierItem, TokenQuotaTierQueryResult } from './sto-token-quota-tier';

export type ExpansionUserType = 'hq' | 'site';
export type ExpansionApplySemantics = 'target_quota' | 'increment' | 'unknown';
export type ExpansionRecordStatus = 'succeeded' | 'failed' | 'error';

export interface GatewayPayloadSnapshot {
  request: { path: string; body: unknown };
  response: unknown;
  duration_ms?: number;
}

export interface ExpandQuotaResult {
  success: boolean;
  message?: string;
  gatewayStatus?: string;
  gatewayPayload?: GatewayPayloadSnapshot;
}

export interface PackageSnapshotV1 {
  schema: 'sto.claw.package_snapshot/v1';
  user_type: ExpansionUserType;
  apply_semantics: ExpansionApplySemantics;
  tenant?: Record<string, string>;
  selected: {
    kind: string;
    tier_name?: string | null;
    pack_name?: string | null;
    quota_amount?: number | null;
    level?: number;
    need_approval?: boolean;
    raw?: unknown;
  };
  context?: Record<string, unknown>;
  raw?: { source?: string; payload?: unknown };
}

export interface BalanceSnapshotV1 {
  schema: 'sto.claw.balance_snapshot/v1';
  user_type: ExpansionUserType;
  normalized: {
    total_quota: number;
    used_quota: number;
    remaining_quota: number;
  };
  raw: {
    spend?: number;
    max_budget?: number;
    token_id?: string;
  };
}

export interface TokenQuotaExpansionRecordPayload {
  apply_code: string;
  emp_code?: string;
  user_code?: string;
  user_name?: string;
  user_type: ExpansionUserType;
  token_id: string;
  apply_action: string;
  quota_amount: number;
  quota_unit: string;
  status: ExpansionRecordStatus;
  gateway_status?: string;
  gateway_message?: string;
  client_app?: string;
  client_version?: string;
  client_platform?: string;
  trace_id?: string;
  client_event_id?: string;
  applied_at?: string;
  package_snapshot: PackageSnapshotV1;
  balance_snapshot?: BalanceSnapshotV1;
  gateway_payload?: GatewayPayloadSnapshot;
  extra?: Record<string, unknown>;
}

export interface ExpansionTierContext {
  tier?: TokenQuotaTierItem;
  tierContext?: TokenQuotaTierQueryResult | null;
  clientEventId?: string;
}
