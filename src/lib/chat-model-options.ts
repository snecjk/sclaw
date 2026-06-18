/**
 * Chat 工具栏 / 首页等处的「当前模型」下拉选项构建（与 Provider 账户列表对齐）。
 */
import type { ProviderListItem } from '@/lib/provider-accounts';
import type { ProviderAccount } from '@/lib/providers';
import { HIDDEN_PROVIDER_IDS } from '@/lib/providers';

/** Strip provider prefix (e.g. sto/qwen3.5-plus → qwen3.5-plus) for UI option matching. */
export function normalizeModelIdForChat(raw: string | undefined | null): string {
  if (!raw?.trim()) return '';
  const trimmed = raw.trim();
  const lastSlash = trimmed.lastIndexOf('/');
  return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
}

export function isConcreteModelId(raw: string | undefined | null): boolean {
  const normalized = normalizeModelIdForChat(raw);
  return Boolean(normalized) && normalized.toLowerCase() !== 'not configured';
}

/** Workspace default model from the default provider account (normalized for UI). */
export function getWorkspaceDefaultModelId(
  accounts: ProviderAccount[],
  defaultAccountId: string | null,
): string {
  if (!defaultAccountId) return '';
  const account = accounts.find((a) => a.id === defaultAccountId);
  if (!account) return '';
  const model = account.model?.trim();
  if (model) return normalizeModelIdForChat(model);
  const customModels = account.metadata?.customModels as string[] | undefined;
  const first = customModels?.find((m) => !HIDDEN_PROVIDER_IDS.has(m));
  return first ? normalizeModelIdForChat(first) : '';
}

/**
 * Workspace default model — raw value (preserves supplier sub-prefix).
 * Use this when sending the model ID to the backend / Gateway, where the
 * full original name (e.g. "dashscope/kimi-k2.6") is required.
 */
export function getWorkspaceDefaultRawModelId(
  accounts: ProviderAccount[],
  defaultAccountId: string | null,
): string {
  if (!defaultAccountId) return '';
  const account = accounts.find((a) => a.id === defaultAccountId);
  if (!account) return '';
  const model = account.model?.trim();
  if (model) return model;
  const customModels = account.metadata?.customModels as string[] | undefined;
  const first = customModels?.find((m) => !HIDDEN_PROVIDER_IDS.has(m));
  return first ?? '';
}

/**
 * Resolve toolbar selected model.
 * - Session override (toolbar switch) wins.
 * - Workspace default (Settings) wins over inherited agent default.
 * - Explicit per-agent model (Agent 详情页单独配置) wins when not inherited.
 */
export function resolveChatToolbarModelId(input: {
  sessionModel?: string;
  agentModelDisplay?: string;
  agentInheritedModel?: boolean;
  workspaceDefaultModel?: string;
  /** STO 内置模型列表：用于识别 main 上残留的旧显式模型，Settings 默认优先 */
  stoCatalogModelIds?: string[];
}): string {
  const session = normalizeModelIdForChat(input.sessionModel);
  if (session) return session;

  const workspace = normalizeModelIdForChat(input.workspaceDefaultModel);
  const agent = normalizeModelIdForChat(input.agentModelDisplay);
  const catalog = (input.stoCatalogModelIds ?? []).map((id) => normalizeModelIdForChat(id));

  // Main 等智能体上残留的 STO 显式模型（如 qwen3.7-max）应让位于 Settings 工作区默认
  if (
    workspace
    && agent
    && agent !== workspace
    && catalog.length > 0
    && catalog.includes(agent)
  ) {
    return workspace;
  }

  if (input.agentInheritedModel === false) {
    if (agent) return agent;
    if (workspace) return workspace;
    return '';
  }

  if (workspace) return workspace;
  if (agent) return agent;
  return '';
}

/** Whether the active session should follow a workspace default model change. */
export function shouldSyncSessionToWorkspaceDefault(
  sessionModel: string | undefined,
  previousWorkspaceModel: string | undefined,
): boolean {
  const session = normalizeModelIdForChat(sessionModel);
  if (!session) return true;
  const previous = normalizeModelIdForChat(previousWorkspaceModel);
  return Boolean(previous && session === previous);
}

export interface ChatModelOption {
  key: string;
  modelId: string;        // ← 原始值（含前缀），用于发给 Gateway / backend
  normalizedId: string;   // ← 截断后的值，用于匹配 selectedModelId
  accountId: string;
  displayName: string;    // ← 截断后的值，UI 展示更干净
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
      for (const rawModelId of customModels) {
        if (HIDDEN_PROVIDER_IDS.has(rawModelId)) continue;
        const normalizedId = normalizeModelIdForChat(rawModelId);
        options.push({
          key: `${account.id}::${rawModelId}`,
          modelId: rawModelId,
          normalizedId,
          accountId: account.id,
          displayName: normalizedId,
          subLabel,
          isBuiltin,
        });
      }
    } else if (account.model) {
      if (!HIDDEN_PROVIDER_IDS.has(account.model)) {
        const normalizedId = normalizeModelIdForChat(account.model);
        options.push({
          key: `${account.id}::${account.model}`,
          modelId: account.model,
          normalizedId,
          accountId: account.id,
          displayName: account.label || normalizedId,
          subLabel: account.model,
          isBuiltin,
        });
      }
    }
  }
  return options;
}
