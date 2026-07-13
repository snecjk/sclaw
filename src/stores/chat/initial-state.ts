import type { ChatState } from './types';
import { DEFAULT_SESSION_KEY } from './types';

/** Data-only state. Actions are composed separately so this stays testable. */
export const initialChatDataState: Pick<
  ChatState,
  | 'messages'
  | 'loading'
  | 'error'
  | 'sending'
  | 'modelSwitching'
  | 'activeRunId'
  | 'streamingText'
  | 'streamingMessage'
  | 'streamingMessages'
  | 'streamingToolResults'
  | 'streamingTools'
  | 'pendingFinal'
  | 'lastChatEventAt'
  | 'lastUserMessageAt'
  | 'optimisticUserMessage'
  | 'pendingToolImages'
  | 'dailyTokenQuotaStatus'
  | 'sessions'
  | 'currentSessionKey'
  | 'currentAgentId'
  | 'runtimeBySessionKey'
  | 'sessionLabels'
  | 'sessionLastActivity'
  | 'sidebarRecentOrder'
  | 'activatingScheduledSessionAt'
  | 'showThinking'
  | 'thinkingLevel'
  | 'workflowCardStates'
  | 'pendingWorkflow'
> = {
  messages: [],
  loading: false,
  error: null,
  sending: false,
  modelSwitching: false,
  activeRunId: null,
  streamingText: '',
  streamingMessage: null,
  streamingMessages: [],
  streamingToolResults: [],
  streamingTools: [],
  pendingFinal: false,
  lastChatEventAt: 0,
  lastUserMessageAt: null,
  optimisticUserMessage: null,
  pendingToolImages: [],
  dailyTokenQuotaStatus: null,
  sessions: [],
  currentSessionKey: DEFAULT_SESSION_KEY,
  currentAgentId: 'main',
  runtimeBySessionKey: {},
  sessionLabels: {},
  sessionLastActivity: {},
  sidebarRecentOrder: [],
  activatingScheduledSessionAt: {},
  showThinking: true,
  thinkingLevel: null,
  workflowCardStates: {},
  pendingWorkflow: null,
};

export const CHAT_PERSISTENCE_NAME = 'stoclaw-chat-session-labels';
