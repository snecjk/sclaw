import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { subscribeHostEvent } from '@/lib/host-events';
import { navigateToMainChatHome } from '@/lib/main-chat-navigation';
import { focusChatMessage } from '@/lib/chat-message-navigation';
import { useChatStore } from '@/stores/chat';
import { useSessionUnreadStore } from '@/stores/session-unread';

interface ChatResultOpenPayload {
  sessionKey?: string;
  runId?: string | null;
  messageId?: string | null;
}

/** Routes native chat-result notification clicks to the exact sidebar conversation. */
export function ChatResultNotificationNavigator() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (location.pathname === '/sprite' || location.pathname === '/float-icon') return undefined;
    return subscribeHostEvent<ChatResultOpenPayload>('chat:result-open', (payload) => {
      const sessionKey = payload?.sessionKey?.trim();
      if (!sessionKey) return;
      void (async () => {
        await useChatStore.getState().loadSessions({ force: true });
        useSessionUnreadStore.getState().markSessionRead(sessionKey);
        navigateToMainChatHome(
          navigate,
          location.pathname,
          () => useChatStore.getState().switchSession(sessionKey),
        );
        if (payload.messageId) focusChatMessage(payload.messageId);
      })();
    });
  }, [location.pathname, navigate]);

  return null;
}
