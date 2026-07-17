import type { ChatSession } from './types';
import { DEFAULT_SESSION_KEY } from './types';
import type { ChatGet, ChatSet, SessionActions } from './store-api';
import { clearSessionEntryFromMap, getAgentIdFromSessionKey, isTemporaryAgentSessionKey } from './session-identity';
import { buildSessionSwitchPatch } from './session-runtime';
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
      set((state) => buildSessionSwitchPatch(state, key, dependencies.resolveEngineType));

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
        runtimeBySessionKey: clearSessionEntryFromMap(state.runtimeBySessionKey, currentSessionKey),
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
