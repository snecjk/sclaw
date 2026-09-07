import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import {
  AGENT_ENGINE_DESCRIPTORS,
  AGENT_ENGINE_TYPES,
  parseAgentEngineType,
  type AgentEngineType,
} from '../../shared/agent-engine';

export interface AgentEnginePolicyOption {
  code: AgentEngineType;
  name: string;
  order: number;
}

/** User-facing policy label shared by every engine selector. */
export function getAgentEnginePolicyOptionLabel(option: AgentEnginePolicyOption): string {
  return option.code === 'pi' ? 'SAgent' : option.name;
}

interface AgentEnginePolicyPayload {
  engines?: Array<{ code?: unknown; name?: unknown; order?: unknown }>;
  defaultEngine?: unknown;
  matchedBy?: unknown;
  configVersion?: unknown;
}

interface AgentEnginePolicyResponse {
  success?: boolean;
  data?: AgentEnginePolicyPayload;
}

interface AgentEnginePolicyState {
  engines: AgentEnginePolicyOption[];
  defaultEngine: AgentEngineType;
  matchedBy: 'user' | 'department' | 'default';
  configVersion: string;
  ownerCode: string;
  loading: boolean;
  loaded: boolean;
  fetchedAt: number;
  error: string | null;
  fetchPolicy: (ownerCode: string, force?: boolean) => Promise<void>;
  reset: () => void;
}

export const LEGACY_AGENT_ENGINE_OPTIONS: AgentEnginePolicyOption[] = AGENT_ENGINE_TYPES.map(
  (code, index) => ({
    code,
    name: AGENT_ENGINE_DESCRIPTORS[code].label,
    order: (index + 1) * 10,
  }),
);

const cachedPolicies = new Map<string, ReturnType<typeof normalizeAgentEnginePolicy>>();
let inFlight: { ownerCode: string; promise: Promise<void> } | null = null;
const POLICY_REFRESH_INTERVAL_MS = 20 * 60 * 1000;

export function normalizeAgentEnginePolicy(payload: AgentEnginePolicyPayload | undefined) {
  const seen = new Set<AgentEngineType>();
  const engines = (payload?.engines ?? [])
    .map((item, index): AgentEnginePolicyOption | null => {
      const code = parseAgentEngineType(item.code);
      if (!code || seen.has(code)) return null;
      seen.add(code);
      const label = typeof item.name === 'string' && item.name.trim()
        ? item.name.trim()
        : AGENT_ENGINE_DESCRIPTORS[code].label;
      return {
        code,
        name: label,
        order: typeof item.order === 'number' && Number.isFinite(item.order)
          ? item.order
          : (index + 1) * 10,
      };
    })
    .filter((item): item is AgentEnginePolicyOption => item != null)
    .sort((a, b) => a.order - b.order);

  const effectiveEngines = engines.length > 0 ? engines : LEGACY_AGENT_ENGINE_OPTIONS;
  const requestedDefault = parseAgentEngineType(payload?.defaultEngine);
  const defaultEngine = requestedDefault && effectiveEngines.some((item) => item.code === requestedDefault)
    ? requestedDefault
    : effectiveEngines[0].code;
  const matchedBy = payload?.matchedBy === 'user' || payload?.matchedBy === 'department'
    ? payload.matchedBy
    : 'default';

  return {
    engines: effectiveEngines,
    defaultEngine,
    matchedBy,
    configVersion: typeof payload?.configVersion === 'string' ? payload.configVersion : '',
  } as const;
}

const initialPolicy = normalizeAgentEnginePolicy(undefined);

export const useAgentEnginePolicyStore = create<AgentEnginePolicyState>((set, get) => ({
  ...initialPolicy,
  ownerCode: '',
  loading: false,
  loaded: false,
  fetchedAt: 0,
  error: null,

  fetchPolicy: async (rawOwnerCode, force = false) => {
    const ownerCode = rawOwnerCode.trim() || 'current-user';
    const current = get();
    if (
      !force
      && current.loaded
      && current.ownerCode === ownerCode
      && Date.now() - current.fetchedAt < POLICY_REFRESH_INTERVAL_MS
    ) return;
    if (inFlight?.ownerCode === ownerCode) return inFlight.promise;

    const promise = (async () => {
      set({ loading: true, error: null });
      try {
        const response = await hostApiFetch<AgentEnginePolicyResponse>(
          '/ai-memory/agent/v1/client-config/agent-engines',
        );
        if (response.success === false || !response.data) {
          throw new Error('服务端未返回 Agent 引擎配置');
        }
        const normalized = normalizeAgentEnginePolicy(response.data);
        cachedPolicies.set(ownerCode, normalized);
        set({
          ...normalized,
          ownerCode,
          loading: false,
          loaded: true,
          fetchedAt: Date.now(),
          error: null,
        });
      } catch (error) {
        const cached = cachedPolicies.get(ownerCode);
        set({
          ...(cached ?? initialPolicy),
          ownerCode,
          loading: false,
          loaded: true,
          fetchedAt: Date.now(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    inFlight = { ownerCode, promise };
    try {
      await promise;
    } finally {
      if (inFlight?.promise === promise) inFlight = null;
    }
  },

  reset: () => set({
    ...initialPolicy,
    ownerCode: '',
    loading: false,
    loaded: false,
    fetchedAt: 0,
    error: null,
  }),
}));
