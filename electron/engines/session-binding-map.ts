import type { SessionEngineBinding } from '../db/models/domain/session-catalog';
import type { EngineSessionRegistryEntry } from './session-registry-types';

export function bindingToRegistryEntry(binding: SessionEngineBinding): EngineSessionRegistryEntry {
  const extra = binding.extra ?? {};
  return {
    sessionKey: binding.sessionKey,
    engineType: binding.engineType,
    agentId: binding.agentId,
    sessionId: binding.engineSessionId ?? undefined,
    cwd: binding.cwd ?? undefined,
    model: binding.model ?? undefined,
    accountId: binding.accountId ?? undefined,
    updatedAt: Date.parse(binding.updatedAt),
    title: typeof extra.title === 'string' ? extra.title : undefined,
    archivedClaudeSessionIds: Array.isArray(extra.archivedClaudeSessionIds)
      ? extra.archivedClaudeSessionIds.map(String)
      : undefined,
    pendingHistoryBridge: extra.pendingHistoryBridge === true ? true : undefined,
  };
}
