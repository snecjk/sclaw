import type { ProviderAccount } from '../shared/providers/types';
import {
  getDefaultProviderAccountId,
  listProviderAccounts,
} from '../services/providers/provider-store';

function normalizeModelRef(value?: string): string {
  return (value ?? '').trim();
}

function unqualifiedModelId(value: string): string {
  const slash = value.lastIndexOf('/');
  return slash >= 0 ? value.slice(slash + 1) : value;
}

function uniqueModelRefs(values: Array<string | undefined>): string[] {
  return [...new Set(values.map(normalizeModelRef).filter(Boolean))];
}

function findCatalogMatch(requested: string, catalog: string[]): string | undefined {
  if (!requested) return undefined;
  const exact = catalog.find((candidate) => candidate === requested);
  if (exact) return exact;
  const normalized = unqualifiedModelId(requested);
  return catalog.find((candidate) => unqualifiedModelId(candidate) === normalized);
}

function selectFromAccount(
  account: ProviderAccount,
  requestedModel: string,
): { model: string; fallbackApplied: boolean } | null {
  const catalog = uniqueModelRefs(account.metadata?.customModels ?? []);
  const configuredFallbacks = uniqueModelRefs([
    account.model,
    ...(account.fallbackModels ?? []),
  ]);

  if (catalog.length > 0) {
    const requestedMatch = findCatalogMatch(requestedModel, catalog);
    if (requestedMatch) {
      return { model: requestedMatch, fallbackApplied: requestedMatch !== requestedModel };
    }
    for (const fallback of configuredFallbacks) {
      const fallbackMatch = findCatalogMatch(fallback, catalog);
      if (fallbackMatch) return { model: fallbackMatch, fallbackApplied: true };
    }
    return { model: catalog[0], fallbackApplied: true };
  }

  // An STO account without customModels has not completed its catalog sync. Do not
  // pass a stale/bare model to Claude; another ready/default account may still work.
  if (account.vendorId === 'sto') return null;

  const requestedMatch = findCatalogMatch(requestedModel, configuredFallbacks);
  if (requestedMatch) {
    return { model: requestedMatch, fallbackApplied: requestedMatch !== requestedModel };
  }
  if (configuredFallbacks.length > 0) {
    return { model: configuredFallbacks[0], fallbackApplied: true };
  }
  if (requestedModel) {
    // User-managed providers may intentionally accept arbitrary model ids and have
    // no local catalog. Preserve that existing behavior.
    return { model: requestedModel, fallbackApplied: false };
  }
  return null;
}

export interface ClaudeModelSelection {
  model: string;
  accountId: string;
  fallbackApplied: boolean;
}

export function selectAvailableClaudeModel(input: {
  accounts: ProviderAccount[];
  defaultAccountId?: string;
  requestedAccountId?: string;
  requestedModel?: string;
}): ClaudeModelSelection | null {
  const enabledAccounts = input.accounts.filter((account) => account.enabled !== false);
  const requestedAccountId = normalizeModelRef(input.requestedAccountId);
  const defaultAccountId = normalizeModelRef(input.defaultAccountId);
  const requestedModel = normalizeModelRef(input.requestedModel);
  const ordered = [
    enabledAccounts.find((account) => account.id === requestedAccountId),
    enabledAccounts.find((account) => account.id === defaultAccountId),
    ...enabledAccounts,
  ].filter((account, index, items): account is ProviderAccount => (
    Boolean(account) && items.findIndex((candidate) => candidate?.id === account?.id) === index
  ));

  for (const account of ordered) {
    const selected = selectFromAccount(account, requestedModel);
    if (!selected) continue;
    return {
      model: selected.model,
      accountId: account.id,
      fallbackApplied: selected.fallbackApplied
        || account.id !== requestedAccountId
        || (!requestedModel && Boolean(selected.model)),
    };
  }
  return null;
}

export async function resolveAvailableClaudeModel(input: {
  requestedAccountId?: string;
  requestedModel?: string;
}): Promise<ClaudeModelSelection> {
  const [accounts, defaultAccountId] = await Promise.all([
    listProviderAccounts(),
    getDefaultProviderAccountId(),
  ]);
  const selection = selectAvailableClaudeModel({
    accounts,
    defaultAccountId,
    requestedAccountId: input.requestedAccountId,
    requestedModel: input.requestedModel,
  });
  if (!selection) {
    throw new Error('No available Claude model exists in the current provider model list');
  }
  return selection;
}
