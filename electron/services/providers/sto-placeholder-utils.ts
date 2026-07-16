import type { ProviderAccount } from '../../shared/providers/types';

export const STO_CANONICAL_ACCOUNT_ID = 'sto';

/** Legacy prefix used before the single-account refactor. */
export const STO_LEGACY_ACCOUNT_ID_PREFIX = 'sto-model-';

/** OpenClaw provider keys that must not appear in settings (import blocked). */
export const STO_INTERNAL_OPENCLAW_PROVIDER_KEYS = new Set([
  'sto-dynamic-agent-route',
  'custom-sto',
]);

/** Keys removed from openclaw.json after a successful STO model sync. */
export const OPENCLAW_STO_PLACEHOLDER_KEYS_TO_SCRUB = ['custom-sto'] as const;

export function isStoInternalOpenClawKey(key: string): boolean {
  if (STO_INTERNAL_OPENCLAW_PROVIDER_KEYS.has(key)) return true;
  if (key.startsWith(STO_LEGACY_ACCOUNT_ID_PREFIX)) return true;
  if (key.startsWith('custom-sto')) return true;
  return false;
}

/** Legacy provider account ids superseded by the canonical `sto` account. */
export function isLegacyStoProviderAccountId(accountId: string | undefined | null): boolean {
  const trimmed = accountId?.trim();
  if (!trimmed) return false;
  if (trimmed === STO_CANONICAL_ACCOUNT_ID) return false;
  return isStoInternalOpenClawKey(trimmed);
}

// Legacy agents.defaults.model.primary refs like custom-sto/... or sto-model-.../...
export function isLegacyStoOpenClawModelRef(modelRef: string): boolean {
  const trimmed = modelRef.trim();
  if (!trimmed) return false;
  const prefix = trimmed.includes('/') ? trimmed.split('/')[0]! : trimmed;
  return isStoInternalOpenClawKey(prefix);
}

export function extractOpenClawProviderModelIds(
  entry: Record<string, unknown> | undefined,
): string[] {
  if (!entry || !Array.isArray(entry.models)) return [];
  return (entry.models as Array<Record<string, unknown>>)
    .map((m) => (typeof m.id === 'string' ? m.id : ''))
    .filter(Boolean);
}

export function isStoManagedAccount(account: Pick<ProviderAccount, 'id' | 'vendorId'>): boolean {
  return (
    account.vendorId === 'sto'
    || account.id === STO_CANONICAL_ACCOUNT_ID
    || account.id.startsWith(STO_LEGACY_ACCOUNT_ID_PREFIX)
  );
}

export function isStoCatalogReady(account: ProviderAccount): boolean {
  return isStoManagedAccount(account) && (account.metadata?.customModels?.length ?? 0) > 0;
}

/**
 * Placeholder rows that should be hidden in UI / API lists while sync is pending.
 * Includes the canonical `sto` account until customModels is populated.
 */
export function isStaleStoPlaceholderAccount(account: ProviderAccount): boolean {
  if (account.id === 'custom-sto' || account.id.startsWith('custom-sto')) {
    return true;
  }
  if (account.vendorId === 'custom' && account.id.toLowerCase().includes('sto')) {
    return true;
  }
  if (isStoManagedAccount(account) && !isStoCatalogReady(account)) {
    return true;
  }
  return false;
}

/**
 * Accounts to delete once remote /v1/models sync succeeds.
 * Never deletes the canonical `sto` account — that one is updated in place.
 */
export function shouldDeleteStaleStoPlaceholder(account: ProviderAccount): boolean {
  if (account.id === STO_CANONICAL_ACCOUNT_ID) {
    return false;
  }
  if (account.id.startsWith(STO_LEGACY_ACCOUNT_ID_PREFIX)) {
    return true;
  }
  if (account.id === 'custom-sto' || account.id.startsWith('custom-sto')) {
    return true;
  }
  if (account.vendorId === 'custom' && account.id.toLowerCase().includes('sto')) {
    return true;
  }
  if (account.vendorId === 'sto') {
    return true;
  }
  return false;
}
