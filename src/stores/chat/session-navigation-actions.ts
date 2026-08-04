import type { ChatSession } from './types';
import { DEFAULT_SESSION_KEY } from './types';
import type { ChatGet, ChatSet, SessionActions } from './store-api';
import { clearSessionEntryFromMap, getAgentIdFromSessionKey, isTemporaryAgentSessionKey } from './session-identity';
import { clearSessionSendReadiness } from '@/lib/session-send-readiness';

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
      set((state) => {
        const leavingEmpty = isTemporaryAgentSessionKey(state.currentSessionKey)
          && state.messages.length === 0
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
          messages: [],
          loading: false,
          pendingWorkflow: null,
        };
      });

      const targetSession = get().sessions.find((session) => session.key === key);
      if (key !== DEFAULT_SESSION_KEY && !targetSession?.engineType) {
        void get().loadSessions();
      }
      void get().loadHistory();
    },
    switchToAgentMainSession: (agentId) => {
      const key = dependencies.resolveMainSessionKey(agentId);
      if (key) get().switchSession(key);
    },
    cleanupEmptySession: () => {
      const { currentSessionKey, messages, sessionLastActivity, sessionLabels } = get();
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
    },
  };
}

/** Used by deletion/new-session code when it must choose a destination agent. */
export { getAgentIdFromSessionKey };
