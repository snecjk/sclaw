export type AgentEngineType = 'claude' | 'openclaw';

const AGENT_ENGINE_DISPLAY_NAMES: Record<AgentEngineType, string> = {
  claude: 'Claude Agent',
  openclaw: 'OpenClaw',
};

export function getAgentEngineDisplayName(engineType: AgentEngineType): string {
  return AGENT_ENGINE_DISPLAY_NAMES[engineType];
}
