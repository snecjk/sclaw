export const AGENT_ENGINE_TYPES = ['openclaw', 'claude', 'pi'] as const;

export type AgentEngineType = (typeof AGENT_ENGINE_TYPES)[number];

export interface AgentEngineCapabilities {
  chat: boolean;
  scheduledTask: boolean;
  workflow: boolean;
  media: boolean;
  structuredReasoning: boolean;
  structuredTools: boolean;
  reliableRuntimeStatus: boolean;
}

export interface AgentEngineDescriptor {
  type: AgentEngineType;
  label: string;
  sessionPrefixes: readonly string[];
  capabilities: AgentEngineCapabilities;
}

export const AGENT_ENGINE_DESCRIPTORS: Record<AgentEngineType, AgentEngineDescriptor> = {
  openclaw: {
    type: 'openclaw',
    label: 'OpenClaw',
    sessionPrefixes: ['agent:'],
    capabilities: {
      chat: true,
      scheduledTask: true,
      workflow: true,
      media: true,
      structuredReasoning: true,
      structuredTools: true,
      reliableRuntimeStatus: true,
    },
  },
  claude: {
    type: 'claude',
    label: 'Claude Agent',
    sessionPrefixes: ['claude:', 'claude-task:', 'claude-task-run:'],
    capabilities: {
      chat: true,
      scheduledTask: true,
      workflow: true,
      media: true,
      structuredReasoning: true,
      structuredTools: true,
      reliableRuntimeStatus: true,
    },
  },
  pi: {
    type: 'pi',
    label: 'SAgent',
    sessionPrefixes: ['pi:', 'pi-task:'],
    capabilities: {
      chat: true,
      scheduledTask: true,
      workflow: false,
      media: true,
      structuredReasoning: true,
      structuredTools: true,
      reliableRuntimeStatus: true,
    },
  },
};

export function parseAgentEngineType(value: unknown): AgentEngineType | undefined {
  return typeof value === 'string' && (AGENT_ENGINE_TYPES as readonly string[]).includes(value)
    ? value as AgentEngineType
    : undefined;
}

export function getAgentEngineDescriptor(type: AgentEngineType): AgentEngineDescriptor {
  return AGENT_ENGINE_DESCRIPTORS[type];
}
