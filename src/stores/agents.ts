import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import type { ChannelType } from '@/types/channel';
import type { AgentSummary, AgentsSnapshot } from '@/types/agent';
import {
  getBaseAgentIdFromProjectAgentId,
  getProjectIdFromProjectAgentId,
  isProjectAgentId,
  resolveProjectAgentId,
} from '../../shared/project-agent';

interface AgentsState {
  agents: AgentSummary[];
  defaultAgentId: string;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
  loading: boolean;
  error: string | null;
  fetchAgents: () => Promise<void>;
  createAgent: (name: string, options?: { inheritWorkspace?: boolean }) => Promise<void>;
  updateAgent: (agentId: string, name: string) => Promise<void>;
  deleteAgent: (agentId: string) => Promise<void>;
  assignChannel: (agentId: string, channelType: ChannelType) => Promise<void>;
  removeChannel: (agentId: string, channelType: ChannelType) => Promise<void>;
  clearError: () => void;
}

function applySnapshot(snapshot: AgentsSnapshot | undefined) {
  return snapshot ? {
    agents: (snapshot.agents ?? []).filter((agent) => !isProjectAgentId(agent.id)),
    defaultAgentId: snapshot.defaultAgentId ?? 'main',
    configuredChannelTypes: snapshot.configuredChannelTypes ?? [],
    channelOwners: snapshot.channelOwners ?? {},
    channelAccountOwners: snapshot.channelAccountOwners ?? {},
  } : {};
}

export function resolveBaseAgentId(agentId: string | undefined | null): string {
  return getBaseAgentIdFromProjectAgentId(agentId ?? '') ?? (agentId?.trim().toLowerCase() || 'main');
}

export function resolveEffectiveAgent(
  agents: AgentSummary[],
  agentId: string | undefined | null,
  projectId: string | undefined | null,
): AgentSummary | undefined {
  const baseAgentId = resolveBaseAgentId(agentId);
  const baseAgent = agents.find((agent) => agent.id.trim().toLowerCase() === baseAgentId.trim().toLowerCase());
  if (!baseAgent || !projectId || projectId === 'default') {
    return baseAgent;
  }
  const effectiveId = resolveProjectAgentId(projectId, baseAgentId);
  return {
    ...baseAgent,
    id: effectiveId,
    name: `${baseAgent.name} (${projectId.slice(0, 8)})`,
    isDefault: false,
    mainSessionKey: `agent:${effectiveId}:main`,
  };
}

/**
 * Resolve an agent summary for a possibly project-scoped agent id without
 * requiring the caller to know the active project. Falls back to the base
 * agent and returns a project-flavored summary for project agent ids.
 */
export function resolveAgentById(
  agents: AgentSummary[],
  agentId: string | undefined | null,
): AgentSummary | undefined {
  if (!agentId) return undefined;
  const normalized = agentId.trim().toLowerCase();
  const baseAgentId = getBaseAgentIdFromProjectAgentId(normalized) ?? normalized;
  const baseAgent = agents.find((agent) => agent.id.trim().toLowerCase() === baseAgentId.trim().toLowerCase());
  if (!baseAgent) return undefined;
  if (baseAgentId === normalized) return baseAgent;

  const projectId = getProjectIdFromProjectAgentId(normalized);
  return {
    ...baseAgent,
    id: normalized,
    name: `${baseAgent.name} (${projectId?.slice(0, 8) ?? 'project'})`,
    isDefault: false,
    mainSessionKey: `agent:${normalized}:main`,
  };
}

export const useAgentsStore = create<AgentsState>((set) => ({
  agents: [],
  defaultAgentId: 'main',
  configuredChannelTypes: [],
  channelOwners: {},
  channelAccountOwners: {},
  loading: false,
  error: null,

  fetchAgents: async () => {
    set({ loading: true, error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>('/api/agents');
      set({
        ...applySnapshot(snapshot),
        loading: false,
      });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },

  createAgent: async (name: string, options?: { inheritWorkspace?: boolean }) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>('/api/agents', {
        method: 'POST',
        body: JSON.stringify({ name, inheritWorkspace: options?.inheritWorkspace }),
      });
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  updateAgent: async (agentId: string, name: string) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ name }),
        }
      );
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  deleteAgent: async (agentId: string) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}`,
        { method: 'DELETE' }
      );
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  assignChannel: async (agentId: string, channelType: ChannelType) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}/channels/${encodeURIComponent(channelType)}`,
        { method: 'PUT' }
      );
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  removeChannel: async (agentId: string, channelType: ChannelType) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}/channels/${encodeURIComponent(channelType)}`,
        { method: 'DELETE' }
      );
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  clearError: () => set({ error: null }),
}));
