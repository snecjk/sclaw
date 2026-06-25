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
  partial?: Pick<ChatSession, 'label' | 'engineType'>,
): ChatSession[] {
  const normalized = model.trim();
  if (!normalized) return sessions;
  if (sessions.some((session) => session.key === sessionKey)) {
    return sessions.map((session) => (
      session.key === sessionKey ? { ...session, model: normalized } : session
    ));
  }
  return [
    ...sessions,
    {
      key: sessionKey,
      label: partial?.label ?? '新对话',
      engineType: partial?.engineType,
      model: normalized,
    },
  ];
}

/** Workspace default model from the default provider account. */
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
