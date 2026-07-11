// =============================================================================
// ⚠️ DEAD CODE — 这条 chat store 重构链路当前未接入 live store，请勿在此继续开发。
// =============================================================================
//
// 现状说明：
//   本文件（internal.ts）及其下游 runtime-actions.ts → runtime-event-actions.ts
//   → runtime-event-handlers.ts → runtime-ui-actions.ts / session-history-actions.ts
//   构成了一套「并行重构版」chat store（state shape 含 streamingMessages /
//   streamingToolResults 等更丰富字段），但从未被任何模块 import，因此整条链
//   处于死代码状态，运行时不会执行。
//
//   live chat store 是 src/stores/chat.ts 中的内联 useChatStore（export const
//   useChatStore = create(...)），handleChatEvent、loadHistory、sendMessage 等
//   action 均定义在该内联 store 中。需要改动聊天/事件/记忆逻辑时，请改 chat.ts
//   及其直接依赖，不要改本链路。
//
//   特别提示：runtime-event-handlers.ts 中曾添加的 refreshAgentExecutionHistory
//   派发（执行记忆沉淀）因本链路未接入而从未执行；该派发已改到 live 路径
//   finalizeOpenClawRunAfterAgentCompleted（chat.ts）与 Claude history-poll 兜底
//   完成分支。详见 chat.ts。
//
// 以下原实现整体注释保留，便于日后若决定接通此重构版 store 时恢复。接通前请
// 先确认其 state shape 与 live store 对齐，并补齐缺失的 action。
// =============================================================================

/*
import { DEFAULT_SESSION_KEY, type ChatState } from './types';
import { createRuntimeActions } from './runtime-actions';
import { createSessionHistoryActions } from './session-history-actions';
import type { ChatGet, ChatSet } from './store-api';

export const initialChatState: Pick<
  ChatState,
  | 'messages'
  | 'loading'
  | 'error'
  | 'sending'
  | 'activeRunId'
  | 'streamingText'
  | 'streamingMessage'
  | 'streamingMessages'
  | 'streamingToolResults'
  | 'streamingTools'
  | 'pendingFinal'
  | 'lastUserMessageAt'
  | 'pendingToolImages'
  | 'dailyTokenQuotaStatus'
  | 'sessions'
  | 'currentSessionKey'
  | 'currentAgentId'
  | 'sessionLabels'
  | 'sessionLastActivity'
  | 'showThinking'
  | 'thinkingLevel'
> = {
  messages: [],
  loading: false,
  error: null,

  sending: false,
  activeRunId: null,
  streamingText: '',
  streamingMessage: null,
  streamingMessages: [],
  streamingToolResults: [],
  streamingTools: [],
  pendingFinal: false,
  lastUserMessageAt: null,
  pendingToolImages: [],
  dailyTokenQuotaStatus: null,

  sessions: [],
  currentSessionKey: DEFAULT_SESSION_KEY,
  currentAgentId: 'main',
  sessionLabels: {},
  sessionLastActivity: {},

  showThinking: true,
  thinkingLevel: null,
};

export function createChatActions(
  set: ChatSet,
  get: ChatGet,
): Pick<
  ChatState,
  | 'loadSessions'
  | 'switchSession'
  | 'newSession'
  | 'deleteSession'
  | 'cleanupEmptySession'
  | 'loadHistory'
  | 'sendMessage'
  | 'abortRun'
  | 'handleChatEvent'
  | 'toggleThinking'
  | 'refresh'
  | 'clearError'
> {
  return {
    ...createSessionHistoryActions(set, get),
    ...createRuntimeActions(set, get),
  };
}
*/
