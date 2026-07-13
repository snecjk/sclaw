import type { ChatSet, SessionActions } from './store-api';
import { clearActivatingSessionIfHandedOff } from './session-runtime';

/** Local session metadata mutations; remote session operations live elsewhere. */
export function createSessionUiActions(
  set: ChatSet,
): Pick<
  SessionActions,
  'renameSession' | 'markScheduledSessionActivating' | 'clearScheduledSessionActivating' | 'releaseScheduledSessionActivating'
> {
  return {
    renameSession: (key, newName) => {
      const trimmed = newName.trim();
      if (!trimmed) return;
      set((state) => ({
        sessionLabels: { ...state.sessionLabels, [key]: trimmed },
        sessions: state.sessions.map((session) => (
          session.key === key ? { ...session, label: trimmed } : session
        )),
      }));
    },
    markScheduledSessionActivating: (sessionKey) => {
      const key = sessionKey.trim();
      if (!key) return;
      set((state) => ({
        activatingScheduledSessionAt: {
          ...state.activatingScheduledSessionAt,
          [key]: Date.now(),
        },
      }));
    },
    clearScheduledSessionActivating: (sessionKey) => {
      const key = sessionKey.trim();
      if (!key) return;
      set((state) => {
        if (!state.activatingScheduledSessionAt[key]) return state;
        const activatingScheduledSessionAt = { ...state.activatingScheduledSessionAt };
        delete activatingScheduledSessionAt[key];
        return { activatingScheduledSessionAt };
      });
    },
    releaseScheduledSessionActivating: (sessionKey) => {
      const key = sessionKey.trim();
      if (!key) return;
      set((state) => {
        const activatingScheduledSessionAt = clearActivatingSessionIfHandedOff(
          state.activatingScheduledSessionAt,
          key,
          state.runtimeBySessionKey,
          state.sessionLastActivity,
          state.sessions,
        );
        return activatingScheduledSessionAt === state.activatingScheduledSessionAt
          ? state
          : { activatingScheduledSessionAt };
      });
    },
  };
}
