import type { ChatGet, ChatSet, RuntimeActions } from './store-api';
import { useChatRuntimeV2Store } from './runtime-v2-store';

/** Local UI actions that do not perform transport or history work. */
export function createRuntimeUiActions(
  set: ChatSet,
  get: ChatGet,
): Pick<RuntimeActions, 'toggleThinking' | 'refresh' | 'clearError'> {
  return {
    toggleThinking: () => set((state) => ({ showThinking: !state.showThinking })),
    refresh: async () => {
      const { loadHistory, loadSessions } = get();
      await Promise.all([loadHistory(), loadSessions()]);
    },
    clearError: () => useChatRuntimeV2Store.getState().clearError(get().currentSessionKey),
  };
}
