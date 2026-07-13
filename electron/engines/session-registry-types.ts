import type { AgentEngineType } from './types';

export interface EngineSessionRegistryEntry {
  sessionKey: string;
  engineType: AgentEngineType;
  agentId: string;
  sessionId?: string;
  cwd?: string;
  updatedAt?: number;
  title?: string;
  model?: string;
  accountId?: string;
  /** Prior Claude SDK session IDs kept for UI history after in-session model switches. */
  archivedClaudeSessionIds?: string[];
  /** Inject archived transcript on the next user message after a model switch. */
  pendingHistoryBridge?: boolean;
}
