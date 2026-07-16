import { getEngineSessionRegistryEntry, upsertEngineSessionRegistryEntry } from './session-registry';
import type { AgentEngineType } from './types';
import { listAgentsSnapshot } from '../utils/agent-config';
import { getBaseAgentIdFromProjectAgentId } from '../../shared/project-agent';

export function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return (agentId || 'main').trim().toLowerCase();
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

  return resolveAgentEngineType(getAgentIdFromSessionKey(sessionKey));
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
  await upsertEngineSessionRegistryEntry({
    sessionKey,
    engineType,
    agentId: existing?.agentId || getAgentIdFromSessionKey(sessionKey),
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
