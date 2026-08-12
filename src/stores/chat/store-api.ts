import type { ChatState } from './types';

export type ChatSet = (
  partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>),
  replace?: false,
) => void;

export type ChatGet = () => ChatState;

export type SessionActions = Pick<
  ChatState,
  | 'loadSessions'
  | 'switchSession'
  | 'switchToAgentMainSession'
  | 'newSession'
  | 'deleteSession'
  | 'cleanupEmptySession'
  | 'renameSession'
  | 'markScheduledSessionActivating'
  | 'clearScheduledSessionActivating'
  | 'releaseScheduledSessionActivating'
>;

export type HistoryActions = Pick<ChatState, 'loadHistory'>;
export type RuntimeActions = Pick<
  ChatState,
  'sendMessage' | 'abortRun' | 'toggleThinking' | 'refresh' | 'clearError'
>;
export type WorkflowActions = Pick<
  ChatState,
  'setPendingWorkflow' | 'clearPendingWorkflowMemory' | 'clearPendingWorkflow'
>;
