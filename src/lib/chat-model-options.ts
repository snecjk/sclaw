/**
 * Chat 工具栏 / 首页等处的「当前模型」下拉选项构建（与 Provider 账户列表对齐）。
 */
import type { ProviderListItem } from '@/lib/provider-accounts';
import { HIDDEN_PROVIDER_IDS } from '@/lib/providers';

export interface ChatModelOption {
  key: string;
  modelId: string;
  accountId: string;
  displayName: string;
  subLabel: string;
  /** true = STO 内置等 */
  isBuiltin: boolean;
}

export function buildChatModelOptions(providerItems: ProviderListItem[]): ChatModelOption[] {
  const options: ChatModelOption[] = [];
  for (const { account, vendor } of providerItems) {
    if (HIDDEN_PROVIDER_IDS.has(account.id) || HIDDEN_PROVIDER_IDS.has(account.vendorId)) continue;
    const subLabel = account.label || vendor?.name || account.vendorId;
    const isBuiltin = account.vendorId === 'sto';
    const customModels = account.metadata?.customModels as string[] | undefined;
    if (customModels && customModels.length > 0) {
      for (const modelId of customModels) {
        if (HIDDEN_PROVIDER_IDS.has(modelId)) continue;
        options.push({
          key: `${account.id}::${modelId}`,
          modelId,
          accountId: account.id,
          displayName: modelId,
          subLabel,
          isBuiltin,
        });
      }
    } else if (account.model) {
      if (!HIDDEN_PROVIDER_IDS.has(account.model)) {
        options.push({
          key: `${account.id}::${account.model}`,
          modelId: account.model,
          accountId: account.id,
          displayName: account.label || account.model,
          subLabel: account.model,
          isBuiltin,
        });
      }
    }
  }
  return options;
}
