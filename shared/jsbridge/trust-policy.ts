import type { BridgeAiProfile } from './bridge-ai-protocol';
import type { Capability } from './capabilities';
import { JSBRIDGE_ORIGIN_POLICY } from './config';
import { normalizeAppAllowedOrigins } from './origin-policy';

export type BridgeTrustTier = 'catalog' | 'external' | 'internal' | 'untrusted';

export type BridgeContainerKind = 'webview' | 'iframe' | 'managed-window' | 'extension';

export interface BridgeTrustPolicy {
  appId: string;
  trustTier: BridgeTrustTier;
  allowedOrigins: string[];
  capabilities: Capability[];
  consentCapabilities: Capability[];
  hostFetchAllowlist?: string[];
  /** AI invocation profile. Absent means AI is unavailable for this app. */
  ai?: BridgeAiProfile;
}

export interface ResolveTrustPolicyInput {
  appId?: string | null;
  bound?: boolean;
  bridgePolicy?: Partial<Pick<BridgeTrustPolicy, 'allowedOrigins' | 'capabilities' | 'consentCapabilities' | 'hostFetchAllowlist' | 'ai'>> | null;
}

export function resolveTrustTier(input: ResolveTrustPolicyInput): BridgeTrustTier {
  if (input.appId?.startsWith('__') && input.appId.endsWith('__')) {
    return 'internal';
  }
  if (input.bound && input.appId?.trim()) {
    return 'catalog';
  }
  if (input.appId?.trim()) {
    return 'external';
  }
  return 'untrusted';
}

export function resolveTrustPolicy(input: ResolveTrustPolicyInput): BridgeTrustPolicy {
  const appId = input.appId?.trim() || '__untrusted__';
  const trustTier = resolveTrustTier(input);

  let allowedOrigins: string[];
  try {
    allowedOrigins = normalizeAppAllowedOrigins(input.bridgePolicy?.allowedOrigins);
  } catch {
    allowedOrigins = [...JSBRIDGE_ORIGIN_POLICY.globalPatterns];
  }

  return {
    appId,
    trustTier,
    allowedOrigins,
    capabilities: input.bridgePolicy?.capabilities ?? [],
    consentCapabilities: input.bridgePolicy?.consentCapabilities ?? [],
    hostFetchAllowlist: input.bridgePolicy?.hostFetchAllowlist,
    ai: input.bridgePolicy?.ai,
  };
}

/** AI is opt-in per app: neither trust tier nor catalog binding grants it. */
export function isBridgeAiEnabled(policy: Pick<BridgeTrustPolicy, 'ai'>): boolean {
  return policy.ai?.enabled === true;
}
