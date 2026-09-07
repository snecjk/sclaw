/**
 * Ephemeral AI chat pane for the in-app browser drawer (right column).
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AlertCircle, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/stores/chat';
import { useCurrentChatDisplayMessages } from '@/stores/chat/display-selectors';
import { useChatSessionRuntimeView } from '@/stores/chat/runtime-selectors';
import { ChatStaticItemsList } from '@/components/chat/ChatStaticItemsList';
import { AssistantTurnMessage } from '@/pages/Chat/AssistantTurnMessage';
import { useChatDisplay } from '@/pages/Chat/use-chat-display';
import { extractText } from '@/pages/Chat/message-utils';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { HomeComposer } from '@/pages/Home/HomeComposer';
import { resolveEmbedComposerActions } from '../../../shared/embed-composer-actions';
import { useComposerFlowStore } from '@/stores/composer-flow';
import { cn } from '@/lib/utils';
import {
  stoChatColumnContentTrackClass,
  stoChatScrollContentClass,
  stoChatScrollPaneClass,
} from '@/lib/surfaces';
import { OverlayScrollbar } from '@/components/ui/overlay-scrollbar';
import { useSclawBrowserOverlayStore } from '@/stores/sclaw-browser-overlay';
import { useJsBridgeHostStore } from '@/stores/jsbridge-host';
import {
  dispatchJsBridgeStructuredComposerSeed,
  shouldApplyJsBridgeStructuredComposerSeed,
} from '@/lib/jsbridge/apply-composer-seed';
import {
  CHAT_EDIT_DRAFT_EVENT,
  type ChatEditDraftEventDetail,
} from '@/components/input-composer/use-input-composer-edit-draft';
import {
  isQuoteEmbedContextForRuntime,
} from '@/lib/resolve-embed-quote-skill';
import {
  QUOTE_ASSISTANT_SKILL_SLUG,
  QUOTE_ASSISTANT_SKILL_TITLE,
} from '../../../shared/quote-embed-app';
import { useQuoteFlowCardSessionSync } from '@/hooks/use-quote-flow-card-session-sync';
import { SclawBrowserEmbedChatSessions, type SclawBrowserEmbedChatSessionsProps } from './SclawBrowserEmbedChatSessions';

interface SclawBrowserEmbedChatProps {
  sessionKey: string;
  appTitle: string;
  /** Embed runtime id — used for JSBridge composer seed targeting. */
  embedRuntimeId?: string | null;
  onClose?: () => void;
  sessionsProps?: SclawBrowserEmbedChatSessionsProps;
  /** 仅应用广场窄栏：收起输入框工具为下拉 */
  toolbarToolsLayout?: 'inline' | 'dropdown';
}

export function SclawBrowserEmbedChat({
  sessionKey,
  appTitle,
  embedRuntimeId,
  onClose,
  sessionsProps,
  toolbarToolsLayout,
}: SclawBrowserEmbedChatProps) {
  const { t } = useTranslation(['chat', 'common']);
  const closeChatPanel = useSclawBrowserOverlayStore((s) => s.closeChatPanel);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const messages = useCurrentChatDisplayMessages();
  useQuoteFlowCardSessionSync(
    currentSessionKey === sessionKey ? sessionKey : '',
    currentSessionKey === sessionKey ? messages : [],
  );
  const loading = useChatStore((s) => s.loading);
  const {
    sending,
    pendingFinal,
    transcriptPending,
    lastEventAt: canonicalLastEventAt,
    turnAnchorAt,
    streamingMessage,
    streamingMessages,
    streamingToolResults,
    streamingTools,
    error,
    phase,
  } = useChatSessionRuntimeView(sessionKey);
  const showThinking = useChatStore((s) => s.showThinking);
  const clearError = useChatStore((s) => s.clearError);
  const lastChatEventAt = canonicalLastEventAt;

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
    transcriptPending,
    showThinking,
    lastChatEventAt,
    streamMsg,
    streamText,
    streamingMessages,
    streamingToolResults,
    streamingTools,
    turnAnchorAt,
    phase,
  });

  const showLoadingPlaceholder = useMemo(
    () => loading && messages.length === 0,
    [loading, messages.length],
  );

  const handleClose = useCallback(() => {
    if (onClose) onClose();
    else closeChatPanel();
  }, [onClose, closeChatPanel]);

  const embedSeedEntry = useJsBridgeHostStore((s) => (
    embedRuntimeId ? s.embedComposerSeedByRuntimeId[embedRuntimeId] : undefined
  ));
  const composerReady = currentSessionKey === sessionKey;
  const structuredSeed = shouldApplyJsBridgeStructuredComposerSeed(embedSeedEntry);
  const quoteSkillSeededRef = useRef<string | null>(null);
  useEffect(() => {
    if (!composerReady) return;
    dispatchJsBridgeStructuredComposerSeed(embedSeedEntry);
  }, [composerReady, embedSeedEntry]);
  useEffect(() => {
    if (!composerReady || messages.length > 0) return;
    if (structuredSeed) return;
    if (!embedRuntimeId) return;
    if (quoteSkillSeededRef.current === sessionKey) return;
    if (!isQuoteEmbedContextForRuntime(embedRuntimeId)) return;
    quoteSkillSeededRef.current = sessionKey;
    window.dispatchEvent(new CustomEvent<ChatEditDraftEventDetail>(CHAT_EDIT_DRAFT_EVENT, {
      detail: {
        segments: [{
          type: 'skill',
          slug: QUOTE_ASSISTANT_SKILL_SLUG,
          title: QUOTE_ASSISTANT_SKILL_TITLE,
        }],
        text: '',
      },
    }));
  }, [composerReady, embedRuntimeId, messages.length, sessionKey, structuredSeed]);
  const composerSeed = structuredSeed ? undefined : embedSeedEntry?.text;
  const composerScenarioActions = resolveEmbedComposerActions(
    useComposerFlowStore((s) => s.embedComposerActions),
  );
  const sessionReady = currentSessionKey === sessionKey;

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

      {!sessionReady ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        </div>
      ) : (
        <>
      <div className="sclaw-browser-embed-chat__scroll-host">
      <div ref={scrollRef} className={cn(
        stoChatScrollPaneClass,
        // Embed 有独立 Toolbar：保留原 py-4，不受 Workbench Header→正文 8+8 公式约束
        'sclaw-browser-embed-chat__scroll py-4 pt-4',
      )}>
        <div ref={contentRef} className={cn(stoChatScrollContentClass, stoChatColumnContentTrackClass('home', false))}>
          {showLoadingPlaceholder ? (
            <div className="flex justify-center py-10 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
            </div>
          ) : (
            <>
              <ChatStaticItemsList
                items={staticItems}
                messages={messages}
                showThinking={showThinking}
                scrollRef={scrollRef}
                variant="embed"
                sessionKey={sessionKey}
                onReachStart={() => {
                  void useChatStore.getState().loadOlderHistory();
                }}
              />
              {activeTurn ? (
                <AssistantTurnMessage
                  key="active-turn"
                  sessionMessages={messages}
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
        <HomeComposer
          showDisclaimer={false}
          footerAlign="center"
          seedText={composerSeed}
          composerScenarioActions={composerScenarioActions}
          toolbarToolsLayout={toolbarToolsLayout}
          composerDraftSessionKey={sessionKey}
        />
      </div>
        </>
      )}
    </div>
  );
}
