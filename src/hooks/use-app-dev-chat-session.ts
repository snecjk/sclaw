import { useEffect, useRef, useState } from 'react';
import { ensureProjectAgentForWorkspace } from '@/lib/session-catalog-api';
import { ensureAppDevContext } from '@/lib/app-dev-api';
import { logChatFlow } from '@/stores/chat/chat-flow-log';
import {
  buildAppDevSessionKey,
  ensureAppDevSessionEntry,
  isAppDevSessionKey,
} from '@/lib/app-dev-session';
import { useAgentsStore } from '@/stores/agents';
import { useAppDevCatalogStore } from '@/stores/app-dev-catalog';
import { useChatStore } from '@/stores/chat';
import { useSessionCatalogStore } from '@/stores/session-catalog';

export function useAppDevChatSession(workspaceId: string, enabled = true): string | null {
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const restoreSessionKeyRef = useRef<string | null>(null);
  const activeSessionKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !workspaceId) {
      setSessionKey(null);
      activeSessionKeyRef.current = null;
      return;
    }

    let cancelled = false;
    const startedAt = Date.now();
    logChatFlow('appdev.session.attach.start', { workspaceId });
    useAppDevCatalogStore.getState().registerWorkspaceId(workspaceId);
    void useAppDevCatalogStore.getState().refresh().catch(() => undefined);

    void (async () => {
      await useSessionCatalogStore.getState().selectProject(workspaceId).catch(() => undefined);
      const ensured = await ensureProjectAgentForWorkspace({ workspaceId }).catch(() => null);
      if (!ensured?.agentId || cancelled) return;
      await ensureAppDevContext(workspaceId).catch(() => undefined);

      const nextSessionKey = buildAppDevSessionKey(ensured.agentId, workspaceId);
      const chat = useChatStore.getState();
      if (!restoreSessionKeyRef.current && !isAppDevSessionKey(chat.currentSessionKey)) {
        restoreSessionKeyRef.current = chat.currentSessionKey;
      }

      const engineType = useAgentsStore.getState().agents.find((agent) => agent.id === ensured.agentId)?.engineType;
      useChatStore.setState((state) => ({
        sessions: ensureAppDevSessionEntry({
          sessions: state.sessions,
          sessionKey: nextSessionKey,
          engineType,
          agentId: ensured.agentId,
        }),
      }));
      useSessionCatalogStore.setState((state) => ({
        sessionWorkspaceByKey: {
          ...state.sessionWorkspaceByKey,
          [nextSessionKey]: workspaceId,
        },
      }));

      activeSessionKeyRef.current = nextSessionKey;
      setSessionKey(nextSessionKey);
      if (cancelled) return;
      logChatFlow('appdev.session.attach.ready', {
        workspaceId,
        sessionKey: nextSessionKey,
        agentId: ensured.agentId,
        elapsedMs: Date.now() - startedAt,
      });
      useChatStore.getState().switchSession(nextSessionKey);
    })();

    return () => {
      cancelled = true;
      const restoreKey = restoreSessionKeyRef.current;
      const activeSessionKey = activeSessionKeyRef.current;
      const chat = useChatStore.getState();
      if (
        restoreKey
        && activeSessionKey
        && chat.currentSessionKey === activeSessionKey
        && restoreKey !== activeSessionKey
      ) {
        logChatFlow('appdev.session.detach.restore', {
          workspaceId,
          fromSessionKey: activeSessionKey,
          toSessionKey: restoreKey,
        });
        chat.switchSession(restoreKey);
      }
      activeSessionKeyRef.current = null;
      restoreSessionKeyRef.current = null;
    };
  }, [enabled, workspaceId]);

  return sessionKey;
}
