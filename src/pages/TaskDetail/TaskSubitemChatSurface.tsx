import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore, type RawMessage } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { createAutoSendWatcher } from '@/stores/message-queue';
import { stoTaskSubitemKey, useStoTaskSubitemsStore } from '@/stores/sto-task-subitems';
import { STO_TASK_PENDING_COMPOSE_KEY } from '@/lib/sto-task-compose-storage';
import type { StoTaskId } from '@/lib/sto-tasks';
import { ChatMessage } from '@/pages/Chat/ChatMessage';
import { ChatInput, type FileAttachment } from '@/pages/Chat/ChatInput';
import { extractText, extractThinking, extractToolUse, extractImages } from '@/pages/Chat/message-utils';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { useStoTaskSubitemChatSend } from './use-sto-task-subitem-chat-send';

/* sessionStorage one-shot + gateway-gated auto-send intentionally use setState in effects */
/* eslint-disable react-hooks/set-state-in-effect */

export function TaskSubitemChatSurface({ taskId, entryId }: { taskId: StoTaskId; entryId: string }) {
  const { t } = useTranslation(['home', 'chat', 'common']);
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

  const [streamingTimestamp] = useState(() => Date.now());
  const [composeSeed, setComposeSeed] = useState<string | undefined>();
  const [pendingAutoSendText, setPendingAutoSendText] = useState<string | null>(null);
  const composeBootRef = useRef(false);

  const { contentRef, scrollRef } = useStickToBottomInstant(sessionKey || storeSubKey);

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
    if (composeBootRef.current) return;
    composeBootRef.current = true;
    try {
      const raw = sessionStorage.getItem(STO_TASK_PENDING_COMPOSE_KEY);
      if (!raw) return;
      const o = JSON.parse(raw) as { taskId?: string; entryId?: string; cardBase?: string };
      if (o.taskId !== taskId || o.entryId !== entryId || !o.cardBase) return;
      sessionStorage.removeItem(STO_TASK_PENDING_COMPOSE_KEY);
      const prompt = t(`home:summary.${o.cardBase}.defaultComposePrompt`);
      setComposeSeed(prompt);
      setPendingAutoSendText(prompt);
    } catch {
      sessionStorage.removeItem(STO_TASK_PENDING_COMPOSE_KEY);
    }
  }, [taskId, entryId, t]);

  useEffect(() => {
    if (pendingAutoSendText === null || !isGatewayRunning) return;
    const text = pendingAutoSendText;
    setPendingAutoSendText(null);
    void handleSend(text);
  }, [pendingAutoSendText, isGatewayRunning, handleSend]);

  useEffect(() => {
    const unsub = createAutoSendWatcher(() => {
      const el = scrollRef.current;
      el?.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
    });
    return unsub;
  }, [scrollRef]);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
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
      <div className="mt-4 flex min-h-[min(70vh,520px)] flex-col items-center justify-center rounded-xl border border-[var(--sto-sidebar-border)] bg-[var(--sto-page-bg)] dark:border-border dark:bg-muted/20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  return (
    <div className="mt-4 flex min-h-[min(70vh,520px)] flex-col rounded-xl border border-[var(--sto-sidebar-border)] bg-[var(--sto-page-bg)] dark:border-border dark:bg-muted/20">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div ref={contentRef} className="mx-auto max-w-3xl space-y-4">
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
        <div className="border-t border-destructive/20 bg-destructive/10 px-4 py-2">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-2">
            <p className="text-sm text-destructive">{error}</p>
            <button type="button" onClick={() => void clearError()} className="text-xs underline">
              {t('common:actions.dismiss')}
            </button>
          </div>
        </div>
      ) : null}

      <div className="shrink-0 border-t border-[var(--sto-sidebar-border)] p-3 dark:border-border">
        <ChatInput
          variant="embedded"
          seedText={composeSeed}
          onSend={onSend}
          onStop={() => void abortRun()}
          onQueue={handleQueue}
          disabled={!isGatewayRunning}
          sending={sending}
        />
      </div>
    </div>
  );
}
