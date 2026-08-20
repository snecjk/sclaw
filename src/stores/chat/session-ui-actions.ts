import type { ChatSet, SessionActions } from './store-api';
import { useChatRuntimeV2Store } from './runtime-v2-store';
import { buildChatSessionRuntimeView } from './runtime-selectors';

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
      void import('@/stores/session-catalog').then(({ useSessionCatalogStore }) => {
        void useSessionCatalogStore.getState().patchSessionCatalog({ sessionKey: key, title: trimmed });
      });
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
        if (!state.activatingScheduledSessionAt[key]) return state;
        const runtime = buildChatSessionRuntimeView(
          useChatRuntimeV2Store.getState().sessionsByKey[key],
        );
        const session = state.sessions.find((item) => item.key === key);
        const hasActivity = (state.sessionLastActivity[key] ?? 0) > 0
          || (typeof session?.updatedAt === 'number' && session.updatedAt > 0);
        if (!runtime.sending && !runtime.activeRunId && !hasActivity) return state;
        const activatingScheduledSessionAt = { ...state.activatingScheduledSessionAt };
        delete activatingScheduledSessionAt[key];
        return { activatingScheduledSessionAt };
      });
    },
  };
}
