import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowDown, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore, type RawMessage } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { createAutoSendWatcher, useMessageQueueStore } from '@/stores/message-queue';
import { stoTaskSubitemKey, useStoTaskSubitemsStore } from '@/stores/sto-task-subitems';
import {
  STO_TASK_PENDING_COMPOSE_KEY,
  STO_TASK_SUBITEM_NAV_SCROLL_END,
  type StoTaskSubitemLocationState,
} from '@/lib/sto-task-compose-storage';
import { cn } from '@/lib/utils';
import type { StoTaskId } from '@/lib/sto-tasks';
import { ChatMessage } from '@/pages/Chat/ChatMessage';
import { ChatInput, type FileAttachment } from '@/pages/Chat/ChatInput';
import { PendingQueuePanel } from '@/pages/Chat/PendingQueuePanel';
import { extractText, extractThinking, extractToolUse, extractImages } from '@/pages/Chat/message-utils';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { stoTaskSubitemChatCanvasBg } from '@/lib/surfaces';
import { useStoTaskSubitemChatSend } from './use-sto-task-subitem-chat-send';

/* sessionStorage one-shot + gateway-gated auto-send intentionally use setState in effects */
/* eslint-disable react-hooks/set-state-in-effect */

export function TaskSubitemChatSurface({ taskId, entryId }: { taskId: StoTaskId; entryId: string }) {
  const { t } = useTranslation(['home', 'chat', 'common']);
  const location = useLocation();
  const navigate = useNavigate();
  const storeSubKey = useMemo(() => stoTaskSubitemKey(taskId, entryId), [taskId, entryId]);
  const sessionKey = useStoTaskSubitemsStore((s) => s.sessionKeyBySubitem[storeSubKey] ?? '');

  const switchSession = useChatStore((s) => s.switchSession);
  const switchToAgentMainSession = useChatStore((s) => s.switchToAgentMainSession);
  const messages = useChatStore((s) => s.messages);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const loading = useChatStore((s) => s.loading);
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const showThinking = useChatStore((s) => s.showThinking);
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const streamingTools = useChatStore((s) => s.streamingTools);
  const pendingFinal = useChatStore((s) => s.pendingFinal);
  const streamingText = useChatStore((s) => s.streamingText);
  const abortRun = useChatStore((s) => s.abortRun);
  const clearError = useChatStore((s) => s.clearError);
  const activityForSession = useChatStore((s) => s.sessionLastActivity[sessionKey] ?? 0);
  const markSubitemReadFromActivity = useStoTaskSubitemsStore((s) => s.markSubitemReadFromActivity);
  const lastMarkedActivityRef = useRef(0);

  useEffect(() => {
    lastMarkedActivityRef.current = 0;
  }, [sessionKey]);

  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const { handleSend, handleQueue } = useStoTaskSubitemChatSend();

  const queue = useMessageQueueStore((s) => s.queue);
  const queueRemove = useMessageQueueStore((s) => s.remove);
  const queueMoveUp = useMessageQueueStore((s) => s.moveUp);
  const queueMoveDown = useMessageQueueStore((s) => s.moveDown);

  const [streamingTimestamp] = useState(() => Date.now());
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [composeSeed, setComposeSeed] = useState<string | undefined>();
  const [pendingAutoSendText, setPendingAutoSendText] = useState<string | null>(null);
  /** True after we consumed sessionStorage one-shot compose for this subitem (skip generic post-load scroll). */
  const hasOneShotComposeRef = useRef(false);
  /** Generic scroll-to-bottom once per subitem mount (sidebar / deep link / home reused path). */
  const genericScrollDoneRef = useRef(false);

  const { contentRef, scrollRef } = useStickToBottomInstant(sessionKey || storeSubKey);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, [scrollRef]);

  const updateJumpToLatestVisibility = useCallback(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) {
      setShowJumpToLatest(false);
      return;
    }
    const distanceFromBottom =
      scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight;
    setShowJumpToLatest(distanceFromBottom > 240);
  }, [scrollRef]);

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    updateJumpToLatestVisibility();
    scrollElement.addEventListener('scroll', updateJumpToLatestVisibility, { passive: true });
    window.addEventListener('resize', updateJumpToLatestVisibility);

    return () => {
      scrollElement.removeEventListener('scroll', updateJumpToLatestVisibility);
      window.removeEventListener('resize', updateJumpToLatestVisibility);
    };
  }, [sessionKey, scrollRef, updateJumpToLatestVisibility]);

  const lastComposeRouteKeyRef = useRef('');

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    if (sessionKey) {
      switchSession(sessionKey);
    }
    return () => {
      switchToAgentMainSession('main');
    };
  }, [sessionKey, switchSession, switchToAgentMainSession]);

  useEffect(() => {
    genericScrollDoneRef.current = false;
  }, [storeSubKey]);

  useLayoutEffect(() => {
    const routeKey = `${taskId}:${entryId}`;
    if (lastComposeRouteKeyRef.current !== routeKey) {
      lastComposeRouteKeyRef.current = routeKey;
      hasOneShotComposeRef.current = false;
      setComposeSeed(undefined);
      setPendingAutoSendText(null);
    }
    try {
      const raw = sessionStorage.getItem(STO_TASK_PENDING_COMPOSE_KEY);
      if (!raw) return;
      const o = JSON.parse(raw) as { taskId?: string; entryId?: string; cardBase?: string };
      if (o.taskId !== taskId || o.entryId !== entryId || !o.cardBase) return;
      sessionStorage.removeItem(STO_TASK_PENDING_COMPOSE_KEY);
      const prompt = t(`home:summary.${o.cardBase}.defaultComposePrompt`);
      hasOneShotComposeRef.current = true;
      setComposeSeed(prompt);
      setPendingAutoSendText(prompt);
    } catch {
      sessionStorage.removeItem(STO_TASK_PENDING_COMPOSE_KEY);
    }
  }, [taskId, entryId, t]);

  useEffect(() => {
    if (!sessionKey || currentSessionKey !== sessionKey || loading) return;
    const st = location.state as StoTaskSubitemLocationState | null;
    if (st?.[STO_TASK_SUBITEM_NAV_SCROLL_END]) {
      scrollToLatest('auto');
      navigate('.', { replace: true, state: {} });
      genericScrollDoneRef.current = true;
      return;
    }
    if (hasOneShotComposeRef.current) {
      genericScrollDoneRef.current = true;
      return;
    }
    if (genericScrollDoneRef.current) return;
    genericScrollDoneRef.current = true;
    scrollToLatest('auto');
  }, [
    sessionKey,
    currentSessionKey,
    loading,
    location.state,
    navigate,
    scrollToLatest,
  ]);

  useEffect(() => {
    if (pendingAutoSendText === null || !isGatewayRunning) return;
    const text = pendingAutoSendText;
    setPendingAutoSendText(null);
    void handleSend(text).finally(() => {
      setComposeSeed(undefined);
    });
  }, [pendingAutoSendText, isGatewayRunning, handleSend]);

  useEffect(() => {
    const unsub = createAutoSendWatcher(() => {
      const el = scrollRef.current;
      el?.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
    });
    return unsub;
  }, [scrollRef]);

  const streamMsgObj =
    streamingMessage && typeof streamingMessage === 'object'
      ? (streamingMessage as unknown as { role?: string; content?: unknown; timestamp?: number })
      : null;
  const rawStreamText = typeof streamingText === 'string' ? streamingText : '';
  const streamTextResolved = streamMsgObj ? extractText(streamMsgObj) : rawStreamText;
  const hasStreamText = streamTextResolved.trim().length > 0;
  const streamThinking = streamMsgObj ? extractThinking(streamMsgObj) : null;
  const hasStreamThinking = showThinking && !!streamThinking && streamThinking.trim().length > 0;
  const streamTools = streamMsgObj ? extractToolUse(streamMsgObj) : [];
  const hasStreamTools = streamTools.length > 0;
  const streamImages = streamMsgObj ? extractImages(streamMsgObj) : [];
  const hasStreamImages = streamImages.length > 0;
  const hasStreamToolStatus = streamingTools.length > 0;
  const hasAnyStreamContent =
    hasStreamText || hasStreamThinking || hasStreamTools || hasStreamImages || hasStreamToolStatus;
  const shouldRenderStreaming = Boolean(sending && (hasAnyStreamContent || streamMsgObj));

  useEffect(() => {
    updateJumpToLatestVisibility();
  }, [messages.length, shouldRenderStreaming, pendingFinal, updateJumpToLatestVisibility]);

  const isEmpty = !loading && messages.length === 0 && !shouldRenderStreaming;

  useEffect(() => {
    if (currentSessionKey !== sessionKey) return;
    if (sending || shouldRenderStreaming) return;
    if (activityForSession <= 0) return;
    if (activityForSession <= lastMarkedActivityRef.current) return;
    lastMarkedActivityRef.current = activityForSession;
    markSubitemReadFromActivity(taskId, entryId, activityForSession);
  }, [
    currentSessionKey,
    sessionKey,
    activityForSession,
    sending,
    shouldRenderStreaming,
    taskId,
    entryId,
    markSubitemReadFromActivity,
  ]);

  const onSend = useCallback(
    async (text: string, attachments?: FileAttachment[], targetAgentId?: string | null) => {
      scrollToLatest('auto');
      await handleSend(text, attachments, targetAgentId);
      requestAnimationFrame(() => requestAnimationFrame(() => scrollToLatest('smooth')));
    },
    [handleSend, scrollToLatest],
  );

  if (!sessionKey) {
    return (
      <div
        className={cn(
          'mt-4 flex min-h-[min(40vh,360px)] flex-1 flex-col items-center justify-center rounded-xl',
          stoTaskSubitemChatCanvasBg,
        )}
      >
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl',
        stoTaskSubitemChatCanvasBg,
      )}
    >
      <div
        ref={scrollRef}
        className={cn(
          'relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-6 py-4 [scrollbar-gutter:stable]',
          stoTaskSubitemChatCanvasBg,
        )}
      >
        <div ref={contentRef} className="mx-auto max-w-5xl space-y-4">
          {loading && messages.length === 0 ? (
            <div className="flex justify-center py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
            </div>
          ) : null}
          {isEmpty ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('tasks:subitemChatEmpty', { defaultValue: 'No messages yet. Send a message to start.' })}
            </p>
          ) : (
            <>
              {messages.map((msg, idx) => (
                <ChatMessage
                  key={msg.id || `msg-${idx}`}
                  message={msg}
                  showThinking={showThinking}
                  onPreviewFile={() => {}}
                />
              ))}
              {shouldRenderStreaming && (
                <ChatMessage
                  message={
                    (streamMsgObj
                      ? {
                          ...(streamMsgObj as unknown as Record<string, unknown>),
                          role: (typeof streamMsgObj.role === 'string' ? streamMsgObj.role : 'assistant') as RawMessage['role'],
                          content: (streamMsgObj as { content?: unknown }).content ?? rawStreamText,
                          timestamp: streamMsgObj.timestamp ?? streamingTimestamp,
                        }
                      : {
                          role: 'assistant',
                          content: rawStreamText,
                          timestamp: streamingTimestamp,
                        }) as RawMessage
                  }
                  showThinking={showThinking}
                  isStreaming
                  streamingTools={streamingTools}
                  onPreviewFile={() => {}}
                />
              )}
              {sending && pendingFinal && !shouldRenderStreaming ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                  <span>{t('chat:streaming.processingTitle')}</span>
                </div>
              ) : null}
              {sending && !pendingFinal && !hasAnyStreamContent ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                  <span>{t('chat:streaming.thinkingTitle')}</span>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {error ? (
        <div className="shrink-0 border-t border-destructive/20 bg-destructive/10 px-6 py-2">
          <div className="mx-auto flex max-w-5xl items-center justify-between">
            <p className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
              {error}
            </p>
            <button
              type="button"
              onClick={() => void clearError()}
              className="text-xs text-destructive/60 underline hover:text-destructive"
            >
              {t('common:actions.dismiss')}
            </button>
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          'pointer-events-none shrink-0 overflow-hidden px-6',
          showJumpToLatest ? 'py-0.5' : 'h-0 py-0',
        )}
      >
        <div className="mx-auto flex max-w-5xl justify-center">
          <motion.button
            type="button"
            onClick={() => scrollToLatest('smooth')}
            className="pointer-events-auto inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-white/45 px-2.5 text-[11px] font-medium leading-none text-foreground/90 shadow-none backdrop-blur-sm transition-colors hover:bg-white/60 dark:border-white/12 dark:bg-white/[0.08] dark:text-foreground/95 dark:hover:bg-white/[0.14] sm:h-8 sm:px-3 sm:text-xs"
            initial={false}
            animate={{
              opacity: showJumpToLatest ? 1 : 0,
              y: showJumpToLatest ? 0 : 6,
              scale: showJumpToLatest ? 1 : 0.96,
              pointerEvents: showJumpToLatest ? 'auto' : 'none',
            }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <ArrowDown className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" aria-hidden />
            <span>{t('chat:streaming.jumpToLatest')}</span>
          </motion.button>
        </div>
      </div>

      <PendingQueuePanel
        queue={queue}
        onRemove={queueRemove}
        onMoveUp={queueMoveUp}
        onMoveDown={queueMoveDown}
      />

      <ChatInput
        className="pb-0"
        seedText={composeSeed}
        onSend={onSend}
        onStop={() => void abortRun()}
        onQueue={handleQueue}
        disabled={!isGatewayRunning}
        sending={sending}
        isEmpty={isEmpty}
      />
    </div>
  );
}
