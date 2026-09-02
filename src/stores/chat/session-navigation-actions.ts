import type { ChatSession } from './types';
import { DEFAULT_SESSION_KEY } from './types';
import type { ChatGet, ChatSet, SessionActions } from './store-api';
import { clearSessionEntryFromMap, getAgentIdFromSessionKey, isTemporaryAgentSessionKey } from './session-identity';
import { clearSessionSendReadiness } from '@/lib/session-send-readiness';
import { getSessionDisplayMessages } from './display-selectors';
import { useChatRuntimeV2Store } from './runtime-v2-store';
import { markHistoryLoadPerf } from './history-load-perf';

export interface SessionNavigationDependencies {
  markSessionRead: (sessionKey: string) => void;
  resolveMainSessionKey: (agentId: string) => string | null;
  resolveEngineType: (sessionKey: string) => ChatSession['engineType'];
  removeSidebarRecentKey: (keys: string[], sessionKey: string) => string[];
}

export function createSessionNavigationActions(
  set: ChatSet,
  get: ChatGet,
  dependencies: SessionNavigationDependencies,
): Pick<SessionActions, 'switchSession' | 'switchToAgentMainSession' | 'cleanupEmptySession'> {
  return {
    switchSession: (key) => {
      if (key === get().currentSessionKey) return;
      dependencies.markSessionRead(key);
      const leavingKey = get().currentSessionKey;
      set((state) => {
        const leavingEmpty = isTemporaryAgentSessionKey(state.currentSessionKey)
          && getSessionDisplayMessages(state.currentSessionKey).length === 0
          && !state.sessionLastActivity[state.currentSessionKey]
          && !state.sessionLabels[state.currentSessionKey];
        const retainedSessions = leavingEmpty
          ? state.sessions.filter((session) => session.key !== state.currentSessionKey)
          : state.sessions;
        const sessions = retainedSessions.some((session) => session.key === key)
          ? retainedSessions
          : [...retainedSessions, { key, engineType: dependencies.resolveEngineType(key) }];
        return {
          currentSessionKey: key,
          currentAgentId: getAgentIdFromSessionKey(key),
          pendingProjectId: null,
          sessions,
          sessionLabels: leavingEmpty
            ? clearSessionEntryFromMap(state.sessionLabels, state.currentSessionKey)
            : state.sessionLabels,
          sessionLastActivity: leavingEmpty
            ? clearSessionEntryFromMap(state.sessionLastActivity, state.currentSessionKey)
            : state.sessionLastActivity,
          loading: false,
        };
      });
      useChatRuntimeV2Store.getState().trimSessionHistoryTail(leavingKey);

      const targetSession = get().sessions.find((session) => session.key === key);
      if (key !== DEFAULT_SESSION_KEY && !targetSession?.engineType) {
        void get().loadSessions();
      }
      // 本地已有 transcript 时静默刷新：立即展示缓存，避免 loading 遮罩与 minLoading 人为延迟。
      const cachedTranscript = useChatRuntimeV2Store.getState().sessionsByKey[key]?.transcript;
      const hasCachedHistory = (cachedTranscript?.length ?? 0) > 0;
      markHistoryLoadPerf(key, 'session.switch', {
        hasCachedHistory,
        cachedTranscriptCount: cachedTranscript?.length ?? 0,
        displayMessageCount: getSessionDisplayMessages(key).length,
        engineType: dependencies.resolveEngineType(key),
        quietReload: hasCachedHistory,
      });
      void get().loadHistory(hasCachedHistory);
    },
    switchToAgentMainSession: (agentId) => {
      const key = dependencies.resolveMainSessionKey(agentId);
      if (key) get().switchSession(key);
    },
    cleanupEmptySession: () => {
      const { currentSessionKey, sessionLastActivity, sessionLabels } = get();
      const messages = getSessionDisplayMessages(currentSessionKey);
      const isEmptyNonMain = isTemporaryAgentSessionKey(currentSessionKey)
        && messages.length === 0
        && !sessionLastActivity[currentSessionKey]
        && !sessionLabels[currentSessionKey];
      if (!isEmptyNonMain) return;

      set((state) => ({
        sessions: state.sessions.filter((session) => session.key !== currentSessionKey),
        sessionLabels: clearSessionEntryFromMap(state.sessionLabels, currentSessionKey),
        sessionLastActivity: clearSessionEntryFromMap(state.sessionLastActivity, currentSessionKey),
        sidebarRecentOrder: dependencies.removeSidebarRecentKey(
          state.sidebarRecentOrder,
          currentSessionKey,
        ),
      }));
      clearSessionSendReadiness(currentSessionKey);
      useChatRuntimeV2Store.getState().clearSession(currentSessionKey);
    },
  };
}

/** Used by deletion/new-session code when it must choose a destination agent. */
export { getAgentIdFromSessionKey };
