import { useCallback, useEffect } from 'react';
import type { AgentEngineType } from '../../shared/agent-engine';
import {
  getAgentEnginePolicyOptionLabel,
  useAgentEnginePolicyStore,
  type AgentEnginePolicyOption,
} from '@/stores/agent-engine-policy';
import { useAuthStore } from '@/stores/auth';

export interface WorkflowEngineOption extends AgentEnginePolicyOption {
  label: string;
}

export function resolveWorkflowEngineSelection(
  requested: AgentEngineType | null | undefined,
  engines: readonly Pick<AgentEnginePolicyOption, 'code'>[],
  defaultEngine: AgentEngineType,
  unavailable: ReadonlySet<AgentEngineType> = new Set(),
): AgentEngineType {
  const available = engines.map((engine) => engine.code).filter((code) => !unavailable.has(code));
  if (requested && available.includes(requested)) return requested;
  if (available.includes(defaultEngine)) return defaultEngine;
  return available[0] ?? defaultEngine;
}

export function useWorkflowEnginePolicy() {
  const authUserKey = useAuthStore((state) => (
    state.user?.code || state.user?.empCode || state.user?.id || ''
  ));
  const engines = useAgentEnginePolicyStore((state) => state.engines);
  const defaultEngine = useAgentEnginePolicyStore((state) => state.defaultEngine);
  const loading = useAgentEnginePolicyStore((state) => state.loading);
  const loaded = useAgentEnginePolicyStore((state) => state.loaded);
  const ownerCode = useAgentEnginePolicyStore((state) => state.ownerCode);
  const configVersion = useAgentEnginePolicyStore((state) => state.configVersion);
  const fetchPolicy = useAgentEnginePolicyStore((state) => state.fetchPolicy);

  useEffect(() => {
    if (!authUserKey) return;
    void fetchPolicy(authUserKey);
  }, [authUserKey, fetchPolicy]);

  const normalizedOwnerCode = authUserKey.trim() || 'current-user';
  const policyLoaded = loaded && ownerCode === normalizedOwnerCode;
  const options: WorkflowEngineOption[] = engines.map((engine) => ({
    ...engine,
    label: getAgentEnginePolicyOptionLabel(engine),
  }));

  const load = useCallback(async (): Promise<{
    options: WorkflowEngineOption[];
    defaultEngine: AgentEngineType;
  }> => {
    if (authUserKey) await fetchPolicy(authUserKey);
    const current = useAgentEnginePolicyStore.getState();
    return {
      options: current.engines.map((engine) => ({
        ...engine,
        label: getAgentEnginePolicyOptionLabel(engine),
      })),
      defaultEngine: current.defaultEngine,
    };
  }, [authUserKey, fetchPolicy]);

  return {
    options,
    defaultEngine,
    loading,
    loaded: policyLoaded,
    configVersion,
    ownerCode,
    load,
  };
}
