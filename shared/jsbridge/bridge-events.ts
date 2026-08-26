/**
 * Guest-facing bridge events — host pushes only after explicit subscribe.
 */
import type { BridgeTrustPolicy, BridgeTrustTier } from './trust-policy';

/** Quote workbench: SClaw re-opened / refreshed the clawQuotation preview. */
export const BRIDGE_EVENT_QUOTE_PREVIEW_REFRESH = 'quote:preview-refresh' as const;

/** Quote workbench: validation finished (pass/fail). */
export const BRIDGE_EVENT_QUOTE_VALIDATION_COMPLETE = 'quote:validation-complete' as const;

/** Lifecycle — delivered without prior subscribe. */
export const BRIDGE_EVENT_SESSION_DESTROYED = 'bridge:session-destroyed' as const;

export const QUOTE_BRIDGE_EVENTS = [
  BRIDGE_EVENT_QUOTE_PREVIEW_REFRESH,
  BRIDGE_EVENT_QUOTE_VALIDATION_COMPLETE,
] as const;

const EVENT_NAME_RE = /^[a-z][a-z0-9]*(?::[a-z][a-z0-9-]*)+$/;

export function isValidBridgeEventName(name: string): boolean {
  return EVENT_NAME_RE.test(name.trim());
}

export function matchBridgeEventPattern(pattern: string, eventName: string): boolean {
  const patternTrimmed = pattern.trim();
  const eventTrimmed = eventName.trim();
  if (!patternTrimmed || !eventTrimmed) return false;
  if (patternTrimmed === '*') return true;
  if (patternTrimmed === eventTrimmed) return true;
  if (patternTrimmed.endsWith(':*')) {
    const prefix = patternTrimmed.slice(0, -1);
    return eventTrimmed.startsWith(prefix);
  }
  return false;
}

export function isBridgeEventAllowed(
  eventName: string,
  patterns: readonly string[],
): boolean {
  if (!isValidBridgeEventName(eventName)) return false;
  return patterns.some((pattern) => matchBridgeEventPattern(pattern, eventName));
}

const DEFAULT_ALLOWED_EVENT_PATTERNS_BY_TIER: Record<BridgeTrustTier, readonly string[]> = {
  internal: ['*'],
  catalog: ['quote:*'],
  external: [],
  untrusted: [],
};

export function resolveAllowedBridgeEventPatterns(
  policy: Pick<BridgeTrustPolicy, 'trustTier' | 'allowedEventPatterns'>,
): readonly string[] {
  if (policy.allowedEventPatterns?.length) {
    return policy.allowedEventPatterns;
  }
  return DEFAULT_ALLOWED_EVENT_PATTERNS_BY_TIER[policy.trustTier];
}

export function normalizeBridgeEventList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || out.includes(trimmed)) continue;
    out.push(trimmed);
  }
  return out;
}
