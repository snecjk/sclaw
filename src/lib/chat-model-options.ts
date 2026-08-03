/**
 * Chat 工具栏 / 首页等处的「当前模型」下拉选项构建（与 Provider 账户列表对齐）。
 */
import type { ProviderListItem } from '@/lib/provider-accounts';
import type { ProviderAccount } from '@/lib/providers';
import { HIDDEN_PROVIDER_IDS } from '@/lib/providers';
import type { ChatSession } from '@/stores/chat/types';

/** Strip provider prefix (e.g. sto/qwen3.5-plus → qwen3.5-plus) for UI option matching. */
export function normalizeModelIdForChat(raw: string | undefined | null): string {
  if (!raw?.trim()) return '';
  const trimmed = raw.trim();
  const lastSlash = trimmed.lastIndexOf('/');
  return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
}

/** True when a catalog id and user hint refer to the same catalog entry. */
export function catalogModelIdsMatch(hint: string, catalogId: string): boolean {
  const trimmedHint = hint.trim();
  const trimmedCatalog = catalogId.trim();
  if (!trimmedHint || !trimmedCatalog) return false;
  if (trimmedHint === trimmedCatalog) return true;
  if (trimmedHint.endsWith(`/${trimmedCatalog}`)) return true;
  return false;
}

export function isConcreteModelId(raw: string | undefined | null): boolean {
  const normalized = normalizeModelIdForChat(raw);
  return Boolean(normalized) && normalized.toLowerCase() !== 'not configured';
}

/** Home / default session: session override, else Claude agent-scoped model from toolbar switch. */
export function resolveHomePageCarryoverModel(input: {
  sessionKey: string;
  sessions: ChatSession[];
  agentEngineType?: ChatSession['engineType'];
  agentModelDisplay?: string;
}): string | undefined {
  const fromSession = input.sessions.find((session) => session.key === input.sessionKey)?.model;
  if (fromSession?.trim()) return normalizeModelIdForChat(fromSession);
  if (
    input.agentEngineType === 'claude'
    && isConcreteModelId(input.agentModelDisplay)
  ) {
    return normalizeModelIdForChat(input.agentModelDisplay);
  }
  return undefined;
}

/** Upsert session model — home page starts with empty sessions[] until first switch. */
export function upsertSessionModel(
  sessions: ChatSession[],
  sessionKey: string,
  model: string,
  partial?: Pick<ChatSession, 'label' | 'engineType' | 'agentId'>,
): ChatSession[] {
  const normalized = model.trim();
  if (!normalized) return sessions;
  if (sessions.some((session) => session.key === sessionKey)) {
    return sessions.map((session) => (
      session.key === sessionKey
        ? {
          ...session,
          model: normalized,
          ...(partial?.label ? { label: partial.label } : {}),
          ...(partial?.engineType ? { engineType: partial.engineType } : {}),
          ...(partial?.agentId ? { agentId: partial.agentId } : {}),
        }
        : session
    ));
  }
  return [
    ...sessions,
    {
      key: sessionKey,
      label: partial?.label ?? '新对话',
      engineType: partial?.engineType,
      agentId: partial?.agentId,
      model: normalized,
    },
  ];
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
 * Match bare or partial model id to a provider catalog entry
 * (e.g. qwen3.6-plus → dashscope/qwen3.6-plus for STO OpenClaw).
 */
export function resolveProviderRawModelId(
  accounts: ProviderAccount[],
  model: string,
  preferredAccountId?: string | null,
): { modelId: string; accountId: string } | null {
  const trimmed = model.trim();
  if (!trimmed) return null;

  const tryAccount = (account: ProviderAccount): { modelId: string; accountId: string } | null => {
    const customModels = account.metadata?.customModels as string[] | undefined;
    const candidates = [
      ...(customModels ?? []),
      ...(account.model?.trim() ? [account.model.trim()] : []),
    ];
    for (const catalogId of candidates) {
      if (HIDDEN_PROVIDER_IDS.has(catalogId)) continue;
      if (catalogModelIdsMatch(trimmed, catalogId)) {
        return { modelId: catalogId, accountId: account.id };
      }
    }
    for (const catalogId of candidates) {
      if (HIDDEN_PROVIDER_IDS.has(catalogId)) continue;
      if (normalizeModelIdForChat(catalogId) === normalizeModelIdForChat(trimmed)) {
        return { modelId: catalogId, accountId: account.id };
      }
    }
    return null;
  };

  if (preferredAccountId) {
    const preferred = accounts.find((account) => account.id === preferredAccountId);
    if (preferred) {
      const hit = tryAccount(preferred);
      if (hit) return hit;
    }
  }

  for (const account of accounts) {
    const hit = tryAccount(account);
    if (hit) return hit;
  }

  const fallbackAccountId = preferredAccountId?.trim()
    || accounts.find((account) => account.isDefault)?.id
    || accounts[0]?.id;
  return fallbackAccountId ? { modelId: trimmed, accountId: fallbackAccountId } : null;
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
  const customModels = account.metadata?.customModels as string[] | undefined;
  const first = customModels?.find((m) => !HIDDEN_PROVIDER_IDS.has(m));
  const seed = model || first || '';
  if (!seed) return '';
  return resolveProviderRawModelId(accounts, seed, defaultAccountId)?.modelId ?? seed;
}

/**
 * Pick the highest available Qwen 3.x Plus model from enabled provider accounts.
 * Workflow sessions use this as their Claude Agent model override.
 */
export function selectHighestQwenPlusModel(
  accounts: ProviderAccount[],
): { modelId: string; accountId: string } | null {
  const candidates: Array<{ modelId: string; accountId: string; version: number }> = [];

  for (const account of accounts) {
    if (!account.enabled) continue;
    const modelIds = [
      ...(account.metadata?.customModels ?? []),
      ...(account.model?.trim() ? [account.model.trim()] : []),
    ];
    for (const modelId of modelIds) {
      const match = modelId.trim().match(/(?:^|\/)qwen3\.(\d+)-plus$/i);
      if (!match || HIDDEN_PROVIDER_IDS.has(modelId)) continue;
      candidates.push({
        modelId: modelId.trim(),
        accountId: account.id,
        version: Number(match[1]),
      });
    }
  }

  candidates.sort((left, right) => right.version - left.version);
  const selected = candidates[0];
  return selected
    ? { modelId: selected.modelId, accountId: selected.accountId }
    : null;
}

/**
 * Resolve toolbar selected model.
 * - Session override (toolbar switch) wins when still in the live catalog.
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
  /** Live dropdown options — delisted session/agent models are ignored when provided */
  chatModelOptions?: ChatModelOption[];
}): string {
  const options = input.chatModelOptions ?? [];
  const session = options.length > 0
    ? sanitizeChatModelHint(input.sessionModel, options)
    : normalizeModelIdForChat(input.sessionModel);
  if (session) return session;

  const workspace = normalizeModelIdForChat(input.workspaceDefaultModel);
  const agentRaw = normalizeModelIdForChat(input.agentModelDisplay);
  const agent = options.length > 0 && agentRaw
    ? (sanitizeChatModelHint(input.agentModelDisplay, options) || '')
    : agentRaw;
  const catalog = (input.stoCatalogModelIds ?? []).map((id) => normalizeModelIdForChat(id));

  // Agent 绑定的模型已不在 STO 目录（如 qwen3.7-plus → qwen3.7-max 更名后）→ 回退工作区默认
  if (
    workspace
    && agent
    && catalog.length > 0
    && !catalog.includes(agent)
  ) {
    return workspace;
  }

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
  displayName: string;    // ← 与 Models 页一致的完整模型 ID（UI 展示）
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
          displayName: rawModelId,
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

/** Map session / toolbar hint to raw catalog modelId for unique dropdown selection. */
export function resolveChatSelectedModelId(
  options: ChatModelOption[],
  modelHint: string | undefined | null,
): string {
  const trimmed = modelHint?.trim();
  if (!trimmed) return '';

  const exact = options.find((option) => catalogModelIdsMatch(trimmed, option.modelId));
  if (exact) return exact.modelId;

  const normalized = normalizeModelIdForChat(trimmed);
  if (!normalized) return '';

  const matches = options.filter((option) => option.normalizedId === normalized);
  if (matches.length === 1) return matches[0].modelId;
  if (matches.length > 1) {
    const qualified = matches.find((option) => trimmed.endsWith(`/${option.modelId}`));
    if (qualified) return qualified.modelId;
    return matches[0].modelId;
  }

  return trimmed;
}

/** True when hint resolves to an entry still present in the chat model dropdown. */
export function isModelAvailableInChatOptions(
  options: ChatModelOption[],
  hint: string | undefined | null,
): boolean {
  if (!hint?.trim() || options.length === 0) return false;
  const resolved = resolveChatSelectedModelId(options, hint);
  return options.some((option) => option.modelId === resolved);
}

/**
 * Drop session/pending hints that no longer exist in the live catalog
 * (e.g. STO model delisted). Empty options → keep hint (catalog not loaded yet).
 */
export function sanitizeChatModelHint(
  hint: string | undefined | null,
  options: ChatModelOption[],
): string {
  const normalized = normalizeModelIdForChat(hint);
  if (!normalized) return '';
  if (options.length === 0) return normalized;
  if (!isModelAvailableInChatOptions(options, hint)) return '';
  return normalizeModelIdForChat(resolveChatSelectedModelId(options, hint)) || normalized;
}
