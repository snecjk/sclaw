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
  provider?: string;
  accountId?: string;
  /** Pi JSONL 会话文件；凭证永远不写入该文件。 */
  piSessionFile?: string;
  /** Prior Claude SDK session IDs kept for UI history after in-session model switches. */
  archivedClaudeSessionIds?: string[];
  /** Inject archived transcript on the next user message after a model switch. */
  pendingHistoryBridge?: boolean;
}
