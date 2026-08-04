import type { ChatState } from './types';
import { DEFAULT_SESSION_KEY } from './types';

/** Data-only state. Actions are composed separately so this stays testable. */
export const initialChatDataState: Pick<
  ChatState,
  | 'messages'
  | 'loading'
  | 'modelSwitching'
  | 'sessions'
  | 'currentSessionKey'
  | 'currentAgentId'
  | 'sessionLabels'
  | 'sessionLastActivity'
  | 'sidebarRecentOrder'
  | 'activatingScheduledSessionAt'
  | 'showThinking'
  | 'thinkingLevel'
  | 'pendingNewSessionModel'
  | 'pendingProjectId'
  | 'pendingWorkflow'
> = {
  messages: [],
  loading: false,
  modelSwitching: false,
  sessions: [],
  currentSessionKey: DEFAULT_SESSION_KEY,
  currentAgentId: 'main',
  sessionLabels: {},
  sessionLastActivity: {},
  sidebarRecentOrder: [],
  activatingScheduledSessionAt: {},
  showThinking: true,
  thinkingLevel: null,
  pendingNewSessionModel: null,
  pendingProjectId: null,
  pendingWorkflow: null,
};

export const CHAT_PERSISTENCE_NAME = 'stoclaw-chat-session-labels';
