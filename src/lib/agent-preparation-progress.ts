export const AGENT_PREPARATION_PROGRESS_KIND = 'agent-preparation-progress';
export const LEGACY_SKILL_ROUTING_PROGRESS_KIND = 'skill-routing-progress';

export type AgentPreparationStage = 'skill' | 'memory';
export type AgentPreparationStatus = 'running' | 'completed';
export type AgentPreparationMemoryItem = {
  kind: 'preference' | 'execution';
  memory: string;
};

type PreparationMessageLike = {
  id?: string;
  metadata?: Record<string, unknown>;
};

export function getAgentPreparationStage(
  message: PreparationMessageLike | null | undefined,
): AgentPreparationStage | null {
  if (!message) return null;
  const metadata = message.metadata;
  if (
    metadata?.kind === AGENT_PREPARATION_PROGRESS_KIND
    && (metadata.stage === 'skill' || metadata.stage === 'memory')
  ) {
    return metadata.stage;
  }
  if (
    metadata?.kind === LEGACY_SKILL_ROUTING_PROGRESS_KIND
    || message.id?.startsWith('skill-routing-') === true
  ) {
    return 'skill';
  }
  return null;
}

export function isAgentPreparationProgressMessage(
  message: PreparationMessageLike | null | undefined,
): boolean {
  return getAgentPreparationStage(message) !== null;
}

export function getAgentPreparationStatus(
  message: PreparationMessageLike | null | undefined,
): AgentPreparationStatus {
  return message?.metadata?.status === 'completed' ? 'completed' : 'running';
}

export function getAgentPreparationMemories(
  message: PreparationMessageLike | null | undefined,
): AgentPreparationMemoryItem[] {
  const items = message?.metadata?.memories;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const candidate = item as Record<string, unknown>;
    if (
      (candidate.kind !== 'preference' && candidate.kind !== 'execution')
      || typeof candidate.memory !== 'string'
      || !candidate.memory.trim()
    ) {
      return [];
    }
    return [{
      kind: candidate.kind,
      memory: candidate.memory.trim(),
    }];
  });
}
