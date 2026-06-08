export interface AgentSummary {
  id: string;
  name: string;
  isDefault: boolean;
  modelDisplay: string;
  modelAccountId?: string;
  inheritedModel: boolean;
  workspace: string;
  agentDir: string;
  mainSessionKey: string;
  channelTypes: string[];
  fileTransformByOSS?: boolean;
  engineType?: 'openclaw' | 'claude';
}

export interface AgentsSnapshot {
  agents: AgentSummary[];
  defaultAgentId: string;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
}
