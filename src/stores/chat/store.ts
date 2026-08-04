/**
 * Chat State Store v2 implementation
 * Manages chat messages, sessions, streaming, and thinking state.
 * Communicates with OpenClaw Gateway via renderer WebSocket RPC.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useSessionUnreadStore } from '@/stores/session-unread';
import { useAgentsStore } from '../agents';
import {
  removeSidebarRecentOrderKey,
} from '@/lib/sidebar-recent-order';
import {
  scheduleSessionLabelHydrationForStore,
} from '@/stores/chat/session-metadata-hydrate';
import {
  type ChatSession,
  type ChatState,
} from './types';
import type { ChatSet } from './store-api';
import { scrubCorruptedSessionLabels } from '@/lib/session-label';
import { initialChatDataState } from './initial-state';
import { createRuntimeUiActions } from './runtime-ui-actions';
import { createSessionUiActions } from './session-ui-actions';
import { createSessionNavigationActions } from './session-navigation-actions';
import { createWorkflowActions } from './workflow-actions';
import { createSessionLifecycleActions } from './session-lifecycle-actions';
import { createHistoryLoadActions } from './history-load-actions';
import { createSendActions } from './send-actions';
import {
  buildFallbackMainSessionKey,
  clearSessionEntryFromMap,
  getAgentIdFromSessionKey,
  isTemporaryAgentSessionKey,
  normalizeAgentId,
} from './session-identity';
import {
  getFallbackSessionEngineType,
  normalizeSendMessageOptions,
  parseSessionUpdatedAtMs,
  resolveEngineTypeForSession as resolveEngineTypeForSessionWithAgent,
  toMs,
} from './store-helpers';
import type { ResolveChatSessionEngineTypeOptions } from '@/lib/resolve-chat-session-engine-type';
import { getBaseAgentIdFromProjectAgentId } from '../../../shared/project-agent';
import { getSessionDisplayMessages } from './display-selectors';

export type {
  AttachedFileMeta,
  ChatSession,
  ContentBlock,
  RawMessage,
  ToolStatus,
  WorkflowContextBlock,
} from './types';

function getAgentEngineType(agentId: string | undefined | null): ChatSession['engineType'] | undefined {
  const normalizedAgentId = normalizeAgentId(
    getBaseAgentIdFromProjectAgentId(agentId ?? '') ?? agentId,
  );
  return useAgentsStore.getState().agents.find((agent) => normalizeAgentId(agent.id) === normalizedAgentId)?.engineType;
}


function resolveEngineTypeForSession(
  sessions: ChatSession[],
  sessionKey: string,
  agentId?: string | null,
  options?: ResolveChatSessionEngineTypeOptions,
): ChatSession['engineType'] | undefined {
  return resolveEngineTypeForSessionWithAgent(sessions, sessionKey, agentId, getAgentEngineType, options);
}

function scheduleSessionLabelHydrationFromStore(
  set: ChatSet,
  get: () => ChatState,
): void {
  scheduleSessionLabelHydrationForStore(get, set);
}

function resolveMainSessionKeyForAgent(agentId: string | undefined | null): string | null {
  if (!agentId) return null;
  const normalizedAgentId = normalizeAgentId(agentId);
  const summary = useAgentsStore.getState().agents.find((agent) => agent.id === normalizedAgentId);
  return summary?.mainSessionKey || buildFallbackMainSessionKey(normalizedAgentId);
}

function ensureSessionEntry(sessions: ChatSession[], sessionKey: string): ChatSession[] {
  if (sessions.some((session) => session.key === sessionKey)) {
    return sessions;
  }
  const engineType = getFallbackSessionEngineType(sessionKey, getAgentEngineType);
  return [...sessions, { key: sessionKey, engineType }];
}

function buildSessionSwitchPatch(
  state: ChatState,
  nextSessionKey: string,
): Partial<ChatState> {
  const leavingEmpty = isTemporaryAgentSessionKey(state.currentSessionKey)
    && getSessionDisplayMessages(state.currentSessionKey).length === 0
    && !state.sessionLastActivity[state.currentSessionKey]
    && !state.sessionLabels[state.currentSessionKey];
  const sessions = leavingEmpty
    ? state.sessions.filter((session) => session.key !== state.currentSessionKey)
    : state.sessions;
  return {
    currentSessionKey: nextSessionKey,
    currentAgentId: getAgentIdFromSessionKey(nextSessionKey),
    pendingProjectId: null,
    sessions: ensureSessionEntry(sessions, nextSessionKey),
    sessionLabels: leavingEmpty
      ? clearSessionEntryFromMap(state.sessionLabels, state.currentSessionKey)
      : state.sessionLabels,
    sessionLastActivity: leavingEmpty
      ? clearSessionEntryFromMap(state.sessionLastActivity, state.currentSessionKey)
      : state.sessionLastActivity,
    loading: false,
  };
}
function getCanonicalPrefixFromSessionKey(sessionKey: string): string | null {
  if (!sessionKey.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  if (parts.length < 2) return null;
  return `${parts[0]}:${parts[1]}`;
}

// ── Store ────────────────────────────────────────────────────────

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
  ...initialChatDataState,
  setPendingNewSessionModel: (model) => set({ pendingNewSessionModel: model }),
  setPendingProjectId: (projectId) => set({ pendingProjectId: projectId }),
  ...createSessionLifecycleActions(set, get, {
    parseSessionUpdatedAtMs,
    scheduleSessionLabelHydrationFromStore,
    getAgentEngineType,
    getCanonicalPrefixFromSessionKey,
  }),

  ...createHistoryLoadActions(set, get, {
    toMs,
    resolveEngineTypeForSession,
  }),

  ...createSendActions(set, get, {
    normalizeSendMessageOptions,
    resolveMainSessionKeyForAgent,
    buildSessionSwitchPatch,
    resolveEngineTypeForSession,
  }),

  // Local UI/session metadata actions are composed from dedicated modules.
  ...createRuntimeUiActions(set, get),
  ...createSessionUiActions(set),
  ...createWorkflowActions(set, get),
  ...createSessionNavigationActions(set, get, {
    markSessionRead: (sessionKey) => useSessionUnreadStore.getState().markSessionRead(sessionKey),
    resolveMainSessionKey: resolveMainSessionKeyForAgent,
    resolveEngineType: (sessionKey) => ensureSessionEntry([], sessionKey)[0]?.engineType,
    removeSidebarRecentKey: removeSidebarRecentOrderKey,
  }),
}), {
  name: 'stoclaw-chat-session-labels',
  partialize: (state) => ({
    sessionLabels: state.sessionLabels,
    sessionLastActivity: state.sessionLastActivity,
  }),
  merge: (persisted, current) => {
    const stored = persisted as Partial<Pick<typeof current, 'sessionLabels' | 'sessionLastActivity'>>;
    return {
      ...current,
      sessionLabels: scrubCorruptedSessionLabels(stored.sessionLabels ?? {}),
      sessionLastActivity: stored.sessionLastActivity ?? current.sessionLastActivity,
    };
  },
}));
