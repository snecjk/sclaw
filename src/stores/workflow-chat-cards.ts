import { create } from 'zustand';
import { listChatWorkflowCards } from '@/lib/workflow-api';
import type { ChatWorkflowCardRef } from '@/types/workflow';

interface WorkflowChatCardsState {
  refsBySessionKey: Record<string, ChatWorkflowCardRef[]>;
  loadingBySessionKey: Record<string, boolean>;
  loadSession: (sessionKey: string, force?: boolean) => Promise<void>;
  invalidateSession: (sessionKey: string) => Promise<void>;
}

const inFlight = new Map<string, Promise<void>>();
export const EMPTY_WORKFLOW_CHAT_CARD_REFS: ChatWorkflowCardRef[] = [];

export const useWorkflowChatCardsStore = create<WorkflowChatCardsState>((set, get) => ({
  refsBySessionKey: {},
  loadingBySessionKey: {},
  loadSession: async (sessionKey, force = false) => {
    if (!sessionKey) return;
    if (!force && get().refsBySessionKey[sessionKey]) return;
    const existing = inFlight.get(sessionKey);
    if (existing) {
      await existing;
      if (!force) return;
      const queuedRefresh = inFlight.get(sessionKey);
      if (queuedRefresh) return queuedRefresh;
    }

    const request = (async () => {
      set((state) => ({
        loadingBySessionKey: { ...state.loadingBySessionKey, [sessionKey]: true },
      }));
      try {
        const refs = await listChatWorkflowCards(sessionKey);
        set((state) => ({
          refsBySessionKey: { ...state.refsBySessionKey, [sessionKey]: refs },
        }));
      } catch (error) {
        console.warn('[workflow-chat-cards] failed to load card refs', {
          sessionKey,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        set((state) => ({
          loadingBySessionKey: { ...state.loadingBySessionKey, [sessionKey]: false },
        }));
        inFlight.delete(sessionKey);
      }
    })();
    inFlight.set(sessionKey, request);
    return request;
  },
  invalidateSession: async (sessionKey) => get().loadSession(sessionKey, true),
}));

export async function refreshWorkflowChatCards(sessionKey: string): Promise<void> {
  await useWorkflowChatCardsStore.getState().invalidateSession(sessionKey);
}
