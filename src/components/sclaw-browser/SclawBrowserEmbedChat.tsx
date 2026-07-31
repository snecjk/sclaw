/**
 * Ephemeral AI chat pane for the in-app browser drawer (right column).
 */
import { useCallback, useEffect, useMemo } from 'react';
import { AlertCircle, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/stores/chat';
import { useWorkflowCompletion } from '@/hooks/use-workflow-completion';
import { ChatMessage } from '@/pages/Chat/ChatMessage';
import { AssistantTurnMessage } from '@/pages/Chat/AssistantTurnMessage';
import { useChatDisplay } from '@/pages/Chat/use-chat-display';
import { extractText } from '@/pages/Chat/message-utils';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { HomeComposer } from '@/pages/Home/HomeComposer';
import { cn } from '@/lib/utils';
import {
  stoChatColumnContentTrackClass,
  stoChatScrollContentClass,
  stoChatScrollPaneClass,
} from '@/lib/surfaces';
import { OverlayScrollbar } from '@/components/ui/overlay-scrollbar';
import { useSclawBrowserOverlayStore } from '@/stores/sclaw-browser-overlay';
import { SclawBrowserEmbedChatSessions, type SclawBrowserEmbedChatSessionsProps } from './SclawBrowserEmbedChatSessions';

interface SclawBrowserEmbedChatProps {
  sessionKey: string;
  appTitle: string;
  onClose?: () => void;
  sessionsProps?: SclawBrowserEmbedChatSessionsProps;
}

export function SclawBrowserEmbedChat({
  sessionKey,
  appTitle,
  onClose,
  sessionsProps,
}: SclawBrowserEmbedChatProps) {
  const { t } = useTranslation(['chat', 'common']);
  const closeChatPanel = useSclawBrowserOverlayStore((s) => s.closeChatPanel);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const messages = useChatStore((s) => s.messages);
  const loading = useChatStore((s) => s.loading);
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const showThinking = useChatStore((s) => s.showThinking);
  const clearError = useChatStore((s) => s.clearError);
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const streamingMessages = useChatStore((s) => s.streamingMessages);
  const streamingToolResults = useChatStore((s) => s.streamingToolResults);
  const streamingTools = useChatStore((s) => s.streamingTools);
  const pendingFinal = useChatStore((s) => s.pendingFinal);
  const lastChatEventAt = useChatStore((s) => s.lastChatEventAt);

  useWorkflowCompletion(currentSessionKey);

  const streamMsg = streamingMessage && typeof streamingMessage === 'object'
    ? streamingMessage as unknown as { role?: string; content?: unknown; timestamp?: number; id?: string }
    : null;
  const streamText = streamMsg ? extractText(streamMsg) : (typeof streamingMessage === 'string' ? streamingMessage : '');

  const { contentRef, scrollRef } = useStickToBottomInstant(sessionKey);

  useEffect(() => {
    if (currentSessionKey !== sessionKey) return;
    const scrollElement = scrollRef.current;
    scrollElement?.scrollTo({ top: scrollElement.scrollHeight, behavior: 'smooth' });
  }, [currentSessionKey, sessionKey, messages.length, scrollRef, lastChatEventAt]);

  const { staticItems, activeTurn } = useChatDisplay({
    messages,
    sending,
    pendingFinal,
    showThinking,
    lastChatEventAt,
    streamMsg,
    streamText,
    streamingMessages,
    streamingToolResults,
    streamingTools,
  });

  const showLoadingPlaceholder = useMemo(
    () => loading && messages.length === 0,
    [loading, messages.length],
  );

  const handleClose = useCallback(() => {
    if (onClose) onClose();
    else closeChatPanel();
  }, [onClose, closeChatPanel]);

  if (currentSessionKey !== sessionKey) {
    return (
      <div className="sclaw-browser-embed-chat flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  return (
    <div className="sclaw-browser-embed-chat">
      <header className="sclaw-browser-embed-chat__header">
        <div className="min-w-0 flex-1">
          <h2 className="sclaw-browser-embed-chat__title">
            {t('common:moreApps.embedChat.title', { defaultValue: 'AI 助手' })}
          </h2>
          <p className="sclaw-browser-embed-chat__subtitle truncate">{appTitle}</p>
        </div>
        <SclawBrowserEmbedChatSessions {...sessionsProps} />
        <button
          type="button"
          className="sclaw-browser-embed-chat__close"
          onClick={handleClose}
          aria-label={t('common:moreApps.embedChat.close', { defaultValue: '关闭对话' })}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>

      <div className="sclaw-browser-embed-chat__scroll-host">
      <div ref={scrollRef} className={cn(stoChatScrollPaneClass, 'sclaw-browser-embed-chat__scroll')}>
        <div ref={contentRef} className={cn(stoChatScrollContentClass, stoChatColumnContentTrackClass('home', false))}>
          {showLoadingPlaceholder ? (
            <div className="flex justify-center py-10 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
            </div>
          ) : (
            <>
              {staticItems.map((item) => {
                if (item.type === 'assistant-turn') {
                  return (
                    <AssistantTurnMessage
                      key={item.key}
                      turnMessages={item.messages}
                      turnToolResults={item.toolResults}
                      precedingUserMessage={item.precedingUserMessage}
                      showThinking={showThinking}
                    />
                  );
                }
                return (
                  <ChatMessage
                    key={item.key}
                    message={item.message}
                    showThinking={showThinking}
                  />
                );
              })}
              {activeTurn ? (
                <AssistantTurnMessage
                  key="active-turn"
                  turnMessages={activeTurn.turnMessages}
                  turnToolResults={activeTurn.turnToolResults}
                  precedingUserMessage={activeTurn.precedingUserMessage}
                  showThinking={showThinking}
                  activeStream={activeTurn.activeStream}
                />
              ) : null}
            </>
          )}
        </div>
      </div>
      <OverlayScrollbar viewportRef={scrollRef} contentRef={contentRef} />
      </div>

      {error ? (
        <div className="sclaw-browser-embed-chat__error">
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
            {error}
          </p>
          <button type="button" onClick={() => clearError()} className="text-xs text-destructive/70 underline">
            {t('common:actions.dismiss')}
          </button>
        </div>
      ) : null}

      <div className="sclaw-browser-embed-chat__composer">
        <HomeComposer showDisclaimer={false} footerAlign="center" />
      </div>
    </div>
  );
}
