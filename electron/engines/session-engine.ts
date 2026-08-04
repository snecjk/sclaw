import { getEngineSessionRegistryEntry, upsertEngineSessionRegistryEntry } from './session-registry';
import type { AgentEngineType } from './types';
import { listAgentsSnapshot } from '../utils/agent-config';
import { getBaseAgentIdFromProjectAgentId } from '../../shared/project-agent';
import {
  extractAgentIdFromSessionKey,
  parseClaudeTaskIdFromSessionKey,
} from '../../shared/session-agent-id';

export function getAgentIdFromSessionKey(sessionKey: string): string {
  const fromKey = extractAgentIdFromSessionKey(sessionKey);
  if (fromKey) return fromKey.trim().toLowerCase();
  return 'main';
}

/**
 * Resolve owning agentId for a session. Claude task keys require definition / registry lookup.
 */
export async function resolveAgentIdForSessionKey(sessionKey: string): Promise<string> {
  const fromKey = extractAgentIdFromSessionKey(sessionKey);
  if (fromKey) return fromKey.trim().toLowerCase();

  try {
    const registry = await getEngineSessionRegistryEntry(sessionKey);
    if (registry?.agentId?.trim()) return registry.agentId.trim().toLowerCase();
  } catch {
    // ignore
  }

  // 旧 claude-scheduled-task 定义回查已随子系统删除；非 project-agent / 未登记的会话回落到 'main'。
  return 'main';
}

export async function resolveSessionEngineType(
  sessionKey: string,
  preferredEngineType?: AgentEngineType,
): Promise<AgentEngineType> {
  if (preferredEngineType) {
    await rememberSessionEngineType(sessionKey, preferredEngineType).catch(() => {});
    return preferredEngineType;
  }

  const existing = await getEngineSessionRegistryEntry(sessionKey);
  if (existing?.engineType) {
    return existing.engineType;
  }

  if (parseClaudeTaskIdFromSessionKey(sessionKey)) {
    return 'claude';
  }

  return resolveAgentEngineType(await resolveAgentIdForSessionKey(sessionKey));
}

export async function rememberSessionEngineType(
  sessionKey: string,
  engineType: AgentEngineType,
): Promise<void> {
  const existing = await getEngineSessionRegistryEntry(sessionKey);
  if (existing?.engineType === engineType) {
    return;
  }
  const engineChanged = existing?.engineType != null && existing.engineType !== engineType;
  const agentId = existing?.agentId || await resolveAgentIdForSessionKey(sessionKey);
  await upsertEngineSessionRegistryEntry({
    sessionKey,
    engineType,
    agentId,
    sessionId: engineChanged ? undefined : existing?.sessionId,
    cwd: engineChanged ? undefined : existing?.cwd,
    updatedAt: Date.now(),
    title: existing?.title,
    model: existing?.model,
    provider: existing?.provider,
    accountId: existing?.accountId,
    ...(engineChanged && engineType === 'openclaw'
      ? { archivedClaudeSessionIds: undefined, pendingHistoryBridge: undefined }
      : {}),
  });
}

async function resolveAgentEngineType(agentId: string): Promise<AgentEngineType> {
  const snapshot = await listAgentsSnapshot();
  const normalizedAgentId = agentId.trim().toLowerCase();
  const match = snapshot.agents.find((agent) => agent.id.trim().toLowerCase() === normalizedAgentId);
  if (match?.engineType) {
    return match.engineType === 'claude' ? 'claude' : 'openclaw';
  }

  // For project agents that have not yet been persisted, fall back to the
  // base agent's engine type so engine resolution stays consistent.
  const baseAgentId = getBaseAgentIdFromProjectAgentId(normalizedAgentId);
  if (baseAgentId) {
    const baseMatch = snapshot.agents.find((agent) => agent.id.trim().toLowerCase() === baseAgentId.trim().toLowerCase());
    if (baseMatch?.engineType) {
      return baseMatch.engineType === 'claude' ? 'claude' : 'openclaw';
    }
  }

  return 'openclaw';
}
