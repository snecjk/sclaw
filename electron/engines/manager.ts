import { listAgentsSnapshot } from '../utils/agent-config';
import { claudeAdapter } from './claude-adapter';
import { openClawAdapter } from './openclaw-adapter';
import { rememberSessionEngineType, resolveSessionEngineType } from './session-engine';
import { getEngineSessionRegistryEntry } from './session-registry';
import type { AgentEngineType, EngineAdapter, EngineAdapterContext } from './types';
import { filterDeletedSessions } from '../utils/scheduled-task-poller-store';

export async function resolveAgentEngineType(agentId: string): Promise<AgentEngineType> {
  const snapshot = await listAgentsSnapshot();
  const match = snapshot.agents.find((agent) => agent.id.trim().toLowerCase() === agentId.trim().toLowerCase());
  return match?.engineType === 'claude' ? 'claude' : 'openclaw';
}

export function getAdapter(engineType: AgentEngineType): EngineAdapter {
  return engineType === 'claude' ? claudeAdapter : openClawAdapter;
}

export async function getAdapterForSession(
  sessionKey: string,
  preferredEngineType?: AgentEngineType,
): Promise<EngineAdapter> {
  const engineType = await resolveSessionEngineType(sessionKey, preferredEngineType);
  return getAdapter(engineType);
}

export async function listEngineSessions(ctx: EngineAdapterContext): Promise<Array<Record<string, unknown>>> {
  const sessionsByKey = new Map<string, Record<string, unknown>>();

  const upsertSessionSummary = async (
    session: Record<string, unknown>,
    fallbackEngineType: AgentEngineType,
  ): Promise<void> => {
    const sessionKey = String(session.key || '');
    if (!sessionKey) return;

    const engineType = (session.engineType === 'claude' || session.engineType === 'openclaw'
      ? session.engineType
      : fallbackEngineType) as AgentEngineType;

    const normalized = {
      ...session,
      engineType,
    };

    const existing = sessionsByKey.get(sessionKey);
    const remembered = await getEngineSessionRegistryEntry(sessionKey);
    if (!remembered) {
      await rememberSessionEngineType(sessionKey, engineType);
    }

    if (!existing) {
      sessionsByKey.set(sessionKey, normalized);
      return;
    }

    const preferred = remembered?.engineType;
    const existingEngine = existing.engineType === 'claude' ? 'claude' : 'openclaw';
    if (preferred === engineType) {
      sessionsByKey.set(sessionKey, normalized);
      return;
    }
    if (preferred === existingEngine) {
      return;
    }

    sessionsByKey.set(sessionKey, normalized);
  };

  const openClawSessions = await openClawAdapter.listSessions(ctx);
  if (openClawSessions.success && openClawSessions.result?.sessions) {
    for (const session of openClawSessions.result.sessions) {
      await upsertSessionSummary(session, 'openclaw');
    }
  }

  const claudeSessions = await claudeAdapter.listSessions(ctx);
  if (claudeSessions.success && claudeSessions.result?.sessions) {
    for (const session of claudeSessions.result.sessions) {
      await upsertSessionSummary(session, 'claude');
    }
  }

  return await filterDeletedSessions([...sessionsByKey.values()]);
}
