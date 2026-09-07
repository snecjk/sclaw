import { listAgentsSnapshot } from '../utils/agent-config';
import { claudeAdapter } from './claude-adapter';
import { openClawAdapter } from './openclaw-adapter';
import { piAdapter } from './pi-adapter';
import { rememberSessionEngineType, resolveSessionEngineType } from './session-engine';
import { getEngineSessionRegistryEntry } from './session-registry';
import type { AgentEngineType, EngineAdapter, EngineAdapterContext, EngineSessionSummary } from './types';
import { filterDeletedSessions } from '../utils/scheduled-task-poller-store';
import { parseAgentEngineType } from '../../shared/agent-engine';

const adaptersByType = {
  openclaw: openClawAdapter,
  claude: claudeAdapter,
  pi: piAdapter,
} satisfies Record<AgentEngineType, EngineAdapter>;

export function getRegisteredEngineType(value: unknown): AgentEngineType | undefined {
  const parsed = parseAgentEngineType(value);
  return parsed && Object.hasOwn(adaptersByType, parsed) ? parsed : undefined;
}

export async function resolveAgentEngineType(agentId: string): Promise<AgentEngineType> {
  const snapshot = await listAgentsSnapshot();
  const match = snapshot.agents.find((agent) => agent.id.trim().toLowerCase() === agentId.trim().toLowerCase());
  return getRegisteredEngineType(match?.engineType) ?? 'openclaw';
}

export function getAdapter(engineType: AgentEngineType): EngineAdapter {
  const adapter = adaptersByType[engineType];
  if (!adapter) throw new Error(`UNSUPPORTED_ENGINE: ${String(engineType)}`);
  return adapter;
}

export async function getAdapterForSession(
  sessionKey: string,
  preferredEngineType?: unknown,
): Promise<EngineAdapter> {
  const engineType = await resolveSessionEngineType(sessionKey, getRegisteredEngineType(preferredEngineType));
  return getAdapter(engineType);
}

export async function listEngineSessions(ctx: EngineAdapterContext): Promise<Array<Record<string, unknown>>> {
  const sessionsByKey = new Map<string, EngineSessionSummary>();

  const upsertSessionSummary = async (
    session: EngineSessionSummary,
    fallbackEngineType: AgentEngineType,
  ): Promise<void> => {
    const sessionKey = session.key;
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
    const existingEngine = getRegisteredEngineType(existing.engineType) ?? 'openclaw';
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

  const normalizedSessions = [...sessionsByKey.values()].map((session) => ({
    ...session,
    updatedAt: typeof session.updatedAt === 'string'
      ? Date.parse(session.updatedAt)
      : session.updatedAt,
  }));
  return await filterDeletedSessions(normalizedSessions) as unknown as Array<Record<string, unknown>>;
}
