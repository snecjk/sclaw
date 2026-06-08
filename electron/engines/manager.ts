import { getAgentPreferredModel, getAgentWorkspacePath, listAgentsSnapshot } from '../utils/agent-config';
import { claudeAdapter } from './claude-adapter';
import { openClawAdapter } from './openclaw-adapter';
import { getEngineSessionRegistryEntry, listEngineSessionRegistryEntries, upsertEngineSessionRegistryEntry } from './session-registry';
import type { AgentEngineType, EngineAdapter, EngineAdapterContext, EngineSessionSummary } from './types';

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

export async function getAdapterForSession(sessionKey: string): Promise<EngineAdapter> {
  const engineType = await resolveAgentEngineType(getAgentIdFromSessionKey(sessionKey));
  return getAdapter(engineType);
}

export async function listEngineSessions(ctx: EngineAdapterContext): Promise<Array<Record<string, unknown>>> {
  const snapshot = await listAgentsSnapshot();
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

  const claudeEntries = await listEngineSessionRegistryEntries('claude');
  for (const entry of claudeEntries) {
      sessionsByKey.set(entry.sessionKey, {
        key: entry.sessionKey,
        label: entry.title,
        displayName: entry.title,
        updatedAt: entry.updatedAt,
        model: entry.model,
        engineType: 'claude',
      });
    }

  for (const agent of snapshot.agents) {
    if (agent.engineType !== 'claude') continue;
    const mainSessionKey = agent.mainSessionKey;
    const existing = await getEngineSessionRegistryEntry(mainSessionKey);
    if (!existing) {
      const workspacePath = await getAgentWorkspacePath(agent.id);
      const preferredModel = await getAgentPreferredModel(agent.id);
      if (workspacePath) {
        await upsertEngineSessionRegistryEntry({
          sessionKey: mainSessionKey,
          engineType: 'claude',
          agentId: agent.id,
          cwd: workspacePath,
          updatedAt: Date.now(),
          title: agent.name,
          model: preferredModel.model,
          accountId: preferredModel.accountId,
        });
      }
    }
    if (sessionsByKey.has(mainSessionKey)) continue;
    const syntheticSession: EngineSessionSummary = {
      key: mainSessionKey,
      label: agent.name,
      displayName: agent.name,
      model: existing?.model,
      engineType: 'claude',
    };
    sessionsByKey.set(mainSessionKey, syntheticSession as unknown as Record<string, unknown>);
  }

  return [...sessionsByKey.values()];
}
