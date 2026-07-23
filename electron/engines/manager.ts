import { listAgentsSnapshot } from '../utils/agent-config';
import { claudeAdapter } from './claude-adapter';
import { openClawAdapter } from './openclaw-adapter';
import { rememberSessionEngineType, resolveSessionEngineType } from './session-engine';
import { getEngineSessionRegistryEntry } from './session-registry';
import type { AgentEngineType, EngineAdapter, EngineAdapterContext } from './types';
import { filterDeletedSessions } from '../utils/scheduled-task-poller-store';

const adaptersByType = {
  openclaw: openClawAdapter,
  claude: claudeAdapter,
} satisfies Record<AgentEngineType, EngineAdapter>;

export function getRegisteredEngineType(value: unknown): AgentEngineType | undefined {
  return typeof value === 'string' && Object.hasOwn(adaptersByType, value)
    ? value as AgentEngineType
    : undefined;
}

export async function resolveAgentEngineType(agentId: string): Promise<AgentEngineType> {
  const snapshot = await listAgentsSnapshot();
  const match = snapshot.agents.find((agent) => agent.id.trim().toLowerCase() === agentId.trim().toLowerCase());
  return match?.engineType === 'claude' ? 'claude' : 'openclaw';
}

export function getAdapter(engineType: AgentEngineType): EngineAdapter {
  return adaptersByType[engineType];
}

export async function getAdapterForSession(
  sessionKey: string,
  preferredEngineType?: unknown,
): Promise<EngineAdapter> {
  const engineType = await resolveSessionEngineType(sessionKey, getRegisteredEngineType(preferredEngineType));
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

    const engineType = getRegisteredEngineType(session.engineType) ?? fallbackEngineType;

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

  for (const adapter of Object.values(adaptersByType)) {
    const result = await adapter.listSessions(ctx);
    if (result.success && result.result?.sessions) {
      for (const session of result.result.sessions) {
        await upsertSessionSummary(session, adapter.type);
      }
    }
  }

  return await filterDeletedSessions([...sessionsByKey.values()]);
}
