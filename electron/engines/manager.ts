import { listAgentsSnapshot } from '../utils/agent-config';
import { claudeAdapter } from './claude-adapter';
import { openClawAdapter } from './openclaw-adapter';
import type { AgentEngineType, EngineAdapter, EngineAdapterContext } from './types';

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return (agentId || 'main').trim().toLowerCase();
}

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
  const engineType = preferredEngineType ?? await resolveAgentEngineType(getAgentIdFromSessionKey(sessionKey));
  return getAdapter(engineType);
}

export async function listEngineSessions(ctx: EngineAdapterContext): Promise<Array<Record<string, unknown>>> {
  const sessionsByKey = new Map<string, Record<string, unknown>>();

  const openClawSessions = await openClawAdapter.listSessions(ctx);
  if (openClawSessions.success && openClawSessions.result?.sessions) {
    for (const session of openClawSessions.result.sessions) {
      const sessionKey = String(session.key || '');
      if (!sessionKey) continue;
      sessionsByKey.set(sessionKey, {
        ...session,
        engineType: session.engineType || 'openclaw',
      });
    }
  }

  const claudeSessions = await claudeAdapter.listSessions(ctx);
  if (claudeSessions.success && claudeSessions.result?.sessions) {
    for (const session of claudeSessions.result.sessions) {
      const sessionKey = String(session.key || '');
      if (!sessionKey) continue;
      sessionsByKey.set(sessionKey, {
        ...session,
        engineType: session.engineType || 'claude',
      });
    }
  }

  return [...sessionsByKey.values()];
}
