import type { AgentEngineType } from '../../../shared/agent-engine';

export interface ChannelAccountItem {
  accountId: string;
  name: string;
  configured: boolean;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  lastError?: string;
  isDefault: boolean;
  agentId?: string;
  engineType?: AgentEngineType;
}

export interface ChannelGroupItem {
  channelType: string;
  defaultAccountId: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  accounts: ChannelAccountItem[];
}

export interface AgentItem {
  id: string;
  name: string;
  engineType?: 'claude' | 'openclaw' | 'pi';
}

export interface DeleteTarget {
  channelType: string;
  accountId?: string;
}

export interface InlineSelectOption {
  value: string;
  label: string;
}

export type BindingChangeHandler = (next: {
  engineType: AgentEngineType;
  agentId: string;
}) => void | Promise<void>;

export type DingTalkBindingState = {
  engineType?: 'claude' | 'openclaw' | 'pi' | null;
  agentId?: string | null;
  bindStatus?: string | null;
  replaceHint?: 'other_device' | 'unbound' | null;
} | null;

export type MobileBindingState = {
  enabled: boolean;
  configured: boolean;
  engineType: AgentEngineType;
  agentId: string | null;
  wsConnected: boolean;
  canConnectWs: boolean;
  replaceHint?: 'other_device' | 'unbound' | null;
} | null;
