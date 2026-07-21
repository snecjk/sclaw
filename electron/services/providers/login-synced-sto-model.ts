import { getProviderAccount } from './provider-store';
import { STO_CANONICAL_ACCOUNT_ID } from './sto-placeholder-utils';

/**
 * Resolve the STO model catalog already persisted by the post-login model sync.
 * This deliberately performs no remote model request of its own.
 */
export async function getLoginSyncedStoModel(): Promise<string | undefined> {
  const account = await getProviderAccount(STO_CANONICAL_ACCOUNT_ID);
  const selectedModel = account?.model?.trim();
  if (selectedModel) {
    return selectedModel;
  }

  return account?.metadata?.customModels
    ?.find((model) => typeof model === 'string' && model.trim())
    ?.trim();
}
