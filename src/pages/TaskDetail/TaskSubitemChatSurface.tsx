import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowDown, Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore, type AttachedFileMeta, type RawMessage } from '@/stores/chat';
import { useChatPreviewPanel } from '@/hooks/use-chat-preview-panel';
import { useGatewayStore } from '@/stores/gateway';
import { createAutoSendWatcher, /* useMessageQueueStore */ } from '@/stores/message-queue';
import { useSettingsStore } from '@/stores/settings';
import { stoTaskSubitemKey, useStoTaskSubitemsStore } from '@/stores/sto-task-subitems';
import {
  STO_TASK_PENDING_COMPOSE_KEY,
  STO_TASK_SUBITEM_NAV_SCROLL_END,
  type StoTaskSubitemLocationState,
} from '@/lib/sto-task-compose-storage';
// invokeIpc removed – file preview now opens in side panel instead of externally
import { cn } from '@/lib/utils';
import type { StoTaskId } from '@/lib/sto-tasks';
import { ChatMessage } from '@/pages/Chat/ChatMessage';
import { AssistantTurnMessage } from '@/pages/Chat/AssistantTurnMessage';
import { useChatDisplay } from '@/pages/Chat/use-chat-display';
import { ChatPreviewPanel } from '@/pages/Chat/ChatPreviewPanel';
import { ChatPreviewHeaderTabs } from '@/pages/Chat/ChatPreviewHeaderTabs';
import { ChatInput, type FileAttachment } from '@/pages/Chat/ChatInput';
import { ParameterFormDock } from '@/components/parameter-form/ParameterFormDock';
import { useChatInputBindings } from '@/hooks/use-chat-input-bindings';
// import { PendingQueuePanel } from '@/pages/Chat/PendingQueuePanel';
import { extractText } from '@/pages/Chat/message-utils';
import { useChatScrollFollow } from '@/hooks/use-chat-scroll-follow';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { ChatConversationColumn } from '@/components/chat/chat-conversation-column';
import {
  clampPreviewPanelPercent,
  STO_PREVIEW_SPLIT_MAX,
  STO_PREVIEW_SPLIT_MIN,
  stoParameterFormDockLayout,
  stoSplitPreviewPaneClass,
  stoSplitResizerActiveClass,
  stoSplitResizerClass,
  stoSplitRowInsetsClass,
  stoTaskSubitemChatCanvasBg,
} from '@/lib/surfaces';
import { useStoTaskSubitemChatSend } from './use-sto-task-subitem-chat-send';
import { useContentHeader } from '@/components/layout/content-header-context';

/* sessionStorage one-shot + gateway-gated auto-send intentionally use setState in effects */
 

export function TaskSubitemChatSurface({ taskId, entryId }: { taskId: StoTaskId; entryId: string }) {
  const { t } = useTranslation(['home', 'chat', 'common']);
  const location = useLocation();
  const navigate = useNavigate();
  const storeSubKey = useMemo(() => stoTaskSubitemKey(taskId, entryId), [taskId, entryId]);
  const sessionKey = useStoTaskSubitemsStore((s) => s.sessionKeyBySubitem[storeSubKey] ?? '');

  const switchSession = useChatStore((s) => s.switchSession);
  const messages = useChatStore((s) => s.messages);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const loading = useChatStore((s) => s.loading);
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const showThinking = useChatStore((s) => s.showThinking);
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const streamingTools = useChatStore((s) => s.streamingTools);
  const pendingFinal = useChatStore((s) => s.pendingFinal);
  const lastUserMessageAt = useChatStore((s) => s.lastUserMessageAt);
  const streamingText = useChatStore((s) => s.streamingText);
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
  const agents = useAgentsStore((s) => s.agents);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const sessions = useChatStore((s) => s.sessions);
  const { handleSend, handleQueue } = useStoTaskSubitemChatSend();
  const currentAgent = useMemo(
    () => agents.find((agent) => agent.id === currentAgentId),
    [agents, currentAgentId],
  );
  const currentSession = useMemo(
    () => sessions.find((session) => session.key === currentSessionKey),
    [sessions, currentSessionKey],
  );
  const currentEngineType = currentSession?.engineType ?? currentAgent?.engineType;

  // const queue = useMessageQueueStore((s) => s.getQueue(sessionKey));
  // const queueRemove = useCallback((id: string) => useMessageQueueStore.getState().remove(sessionKey, id), [sessionKey]);
  // const queueMoveUp = useCallback((id: string) => useMessageQueueStore.getState().moveUp(sessionKey, id), [sessionKey]);
  // const queueMoveDown = useCallback((id: string) => useMessageQueueStore.getState().moveDown(sessionKey, id), [sessionKey]);

  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [composeSeed, setComposeSeed] = useState<string | undefined>();
  const [pendingAutoSendText, setPendingAutoSendText] = useState<string | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const previewPanelRef = useRef<HTMLDivElement>(null);
  const previewPanelPercent = useSettingsStore((s) => s.previewSplitPercent ?? 50);
  const setPreviewSplitPercent = useSettingsStore((s) => s.setPreviewSplitPercent);
  /** True after we consumed sessionStorage one-shot compose for this subitem (skip generic post-load scroll). */
  const hasOneShotComposeRef = useRef(false);
  /** Generic scroll-to-bottom once per subitem mount (sidebar / deep link / home reused path). */
  const genericScrollDoneRef = useRef(false);

  const { contentRef, scrollRef, scrollToBottom, stopScroll } = useStickToBottomInstant(
    sessionKey || storeSubKey,
  );

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

  /** Avoid painting another session's messages before the store switches (useEffect runs too late). */
  const sessionSynced = Boolean(sessionKey) && currentSessionKey === sessionKey;

  const streamMsgObj =
    streamingMessage && typeof streamingMessage === 'object'
      ? (streamingMessage as unknown as { role?: string; content?: unknown; timestamp?: number; id?: string })
      : null;
  const rawStreamText = typeof streamingText === 'string' ? streamingText : '';
  const streamTextResolved = streamMsgObj ? extractText(streamMsgObj) : rawStreamText;

  const { staticItems, activeTurn, shouldRenderStreaming, hasAnyStreamContent } = useChatDisplay({
    messages: sessionSynced ? messages : [],
    sending: sessionSynced && sending,
    pendingFinal,
    showThinking,
    streamMsg: streamMsgObj,
    streamText: streamTextResolved,
    streamingTools,
  });

  const streamContentKey = useMemo(
    () =>
      [
        messages.length,
        staticItems.length,
        activeTurn ? 1 : 0,
        streamTextResolved.length,
        streamingTools.length,
        pendingFinal ? 1 : 0,
        shouldRenderStreaming ? 1 : 0,
      ].join(':'),
    [
      messages.length,
      staticItems.length,
      activeTurn,
      streamTextResolved.length,
      streamingTools.length,
      pendingFinal,
      shouldRenderStreaming,
    ],
  );

  const { beginSendScroll, scrollToLatest } = useChatScrollFollow({
    scrollRef,
    contentRef,
    scrollToBottom,
    stopScroll,
    sending: sessionSynced && sending,
    lastUserMessageAt,
    hasStreamContent: hasAnyStreamContent || !!activeTurn,
    streamContentKey,
  });

  useLayoutEffect(() => {
    if (sessionKey) {
      switchSession(sessionKey);
    }
  }, [sessionKey, switchSession]);

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
    beginSendScroll();
    void handleSend(text).finally(() => {
      setComposeSeed(undefined);
    });
  }, [pendingAutoSendText, isGatewayRunning, handleSend, beginSendScroll]);

  useEffect(() => {
    const unsub = createAutoSendWatcher(() => scrollToLatest('auto'));
    return unsub;
  }, [scrollToLatest]);

  useEffect(() => {
    updateJumpToLatestVisibility();
  }, [messages.length, shouldRenderStreaming, pendingFinal, updateJumpToLatestVisibility]);

  const displayMessages = sessionSynced ? messages : [];
  const isEmpty =
    sessionSynced && !loading && displayMessages.length === 0 && !shouldRenderStreaming && !activeTurn;

  const allMessagesForPreview = useMemo(() => {
    const arr = [...messages] as RawMessage[];
    if (streamMsgObj) {
      arr.push(streamMsgObj as unknown as RawMessage);
    }
    return arr;
  }, [messages, streamMsgObj]);

  const {
    showPreviewPanel,
    activePreviewFilePath,
    setActivePreviewFilePath,
    previewableFiles,
    canShowPreviewPanel,
    openArtifactPreview,
    openPreviewPanel,
    closePreviewPanel,
    dismissPreviewFile,
    showEditWorkflow,
    workflowId: sessionWorkflowId,
  } = useChatPreviewPanel(allMessagesForPreview, sessionKey);

  const openWorkflowPreview = useCallback((workflowId: string) => {
    navigate(`/workflow/${encodeURIComponent(workflowId)}`);
  }, [navigate]);

  const previewHeaderTabs = useMemo(
    () => (
      showPreviewPanel && previewableFiles.length > 0 ? (
        <ChatPreviewHeaderTabs
          files={previewableFiles}
          activeFilePath={activePreviewFilePath}
          onSelectFile={setActivePreviewFilePath}
          onDismissFile={dismissPreviewFile}
        />
      ) : null
    ),
    [
      showPreviewPanel,
      previewableFiles,
      activePreviewFilePath,
      setActivePreviewFilePath,
      dismissPreviewFile,
    ],
  );

  useContentHeader({
    title: t('common:sidebar.taskList'),
    previewTabs: previewHeaderTabs,
    isSplitLayout: canShowPreviewPanel && showPreviewPanel,
  });

  const isSplitChatLayout = canShowPreviewPanel && showPreviewPanel;

  // Auto-open newly-generated files in the preview panel
  const prevPreviewableFilesRef = useRef(previewableFiles);
  useEffect(() => {
    const prev = prevPreviewableFilesRef.current;
    const prevPaths = new Set(prev.map((f) => f.filePath));
    const newFiles = previewableFiles.filter((f) => f.filePath && !prevPaths.has(f.filePath));

    if (newFiles.length > 0) {
      const latestFile = newFiles[newFiles.length - 1];
      if (latestFile.filePath) {
        openArtifactPreview(latestFile);
      }
    }

    prevPreviewableFilesRef.current = previewableFiles;
  }, [previewableFiles, openArtifactPreview]);

  useEffect(() => {
    if (currentSessionKey !== sessionKey) return;
    if (activityForSession <= 0) return;
    if (activityForSession <= lastMarkedActivityRef.current) return;
    lastMarkedActivityRef.current = activityForSession;
    markSubitemReadFromActivity(taskId, entryId, activityForSession);
  }, [currentSessionKey, sessionKey, activityForSession, taskId, entryId, markSubitemReadFromActivity]);

  const onSend = useCallback(
    async (
      text: string,
      attachments?: FileAttachment[],
      targetAgentId?: string | null,
      dingTalkMentions?: import('@/types/dingtalk-mention').DingTalkMention[],
      workflowId?: string | null,
    ) => {
      beginSendScroll();
      await handleSend(text, attachments, targetAgentId, dingTalkMentions, workflowId);
    },
    [beginSendScroll, handleSend],
  );

  const chatInputProps = useChatInputBindings({
    onSend,
    onQueue: handleQueue,
    isEmpty,
    seedText: composeSeed,
    className: 'pb-0',
    engineType: currentEngineType,
  });

  const handlePreviewFile = useCallback((file: AttachedFileMeta) => {
    openArtifactPreview(file);
  }, [openArtifactPreview]);

  // ── Resizable panel logic ──
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = previewPanelRef.current?.offsetWidth ?? 0;
    const containerWidth = previewPanelRef.current?.parentElement?.clientWidth ?? window.innerWidth;
    let rafId: number | null = null;
    let pendingWidth = startWidth || containerWidth * (previewPanelPercent / 100);

    setIsResizing(true);
    document.body.style.userSelect = 'none';

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:col-resize;';
    document.body.appendChild(overlay);

    const applyWidth = () => {
      rafId = null;
      if (previewPanelRef.current) {
        previewPanelRef.current.style.width = `${pendingWidth}px`;
      }
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const width = previewPanelRef.current?.parentElement?.clientWidth ?? containerWidth;
      pendingWidth = Math.max(
        width * (STO_PREVIEW_SPLIT_MIN / 100),
        Math.min(width * (STO_PREVIEW_SPLIT_MAX / 100), startWidth + delta),
      );
      if (rafId === null) {
        rafId = requestAnimationFrame(applyWidth);
      }
    };

    const cleanup = () => {
      overlay.removeEventListener('mousemove', handleMouseMove);
      overlay.removeEventListener('mouseup', handleMouseUp);
      overlay.remove();
      document.body.style.userSelect = '';
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      setPreviewSplitPercent(clampPreviewPanelPercent(
        previewPanelRef.current?.parentElement?.clientWidth ?? containerWidth,
        pendingWidth,
      ));
      setIsResizing(false);
    };

    const handleMouseUp = () => {
      cleanup();
    };

    overlay.addEventListener('mousemove', handleMouseMove);
    overlay.addEventListener('mouseup', handleMouseUp);

    return () => {
      cleanup();
    };
  }, [previewPanelPercent, setPreviewSplitPercent]);

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
        'relative flex min-h-0 flex-1 flex-row overflow-hidden rounded-xl',
        stoTaskSubitemChatCanvasBg,
        isSplitChatLayout && stoSplitRowInsetsClass,
      )}
    >
      {/* Left: Chat area */}
      <ChatConversationColumn variant="page" isSplitLayout={isSplitChatLayout}>
        <div
          ref={scrollRef}
          className={cn(
            'relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-y-contain py-4 [scrollbar-gutter:stable]',
            stoTaskSubitemChatCanvasBg,
          )}
        >
          <div ref={contentRef} className="space-y-4">
            {!sessionSynced || (loading && displayMessages.length === 0) ? (
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
                {staticItems.map((item) => {
                  if (item.type === 'assistant-turn') {
                    return (
                      <AssistantTurnMessage
                        key={item.key}
                        turnMessages={item.messages}
                        turnToolResults={item.toolResults}
                        precedingUserMessage={item.precedingUserMessage}
                        showThinking={showThinking}
                        onPreviewFile={handlePreviewFile}
                      />
                    );
                  }
                  return (
                    <ChatMessage
                      key={item.key}
                      message={item.message}
                      showThinking={showThinking}
                      onPreviewFile={handlePreviewFile}
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
                    onPreviewFile={handlePreviewFile}
                  />
                ) : null}
              </>
            )}
          </div>
        </div>

        {error ? (
          <div className="shrink-0 border-t border-destructive/20 bg-destructive/10 py-2">
            <div className="flex items-center justify-between">
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
            'pointer-events-none shrink-0 overflow-hidden',
            showJumpToLatest ? 'py-0.5' : 'h-0 py-0',
          )}
        >
          <div className="flex justify-center">
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

        <div className="relative z-10 w-full shrink-0">
          <ParameterFormDock layout={stoParameterFormDockLayout('page')} />
        </div>

        <ChatInput {...chatInputProps} engineType={currentEngineType} />
      </ChatConversationColumn>

      {/* Resizer */}
      {canShowPreviewPanel && showPreviewPanel && (
        <div
          onMouseDown={startResize}
          className={cn(
            stoSplitResizerClass,
            isResizing && stoSplitResizerActiveClass,
          )}
          style={{ cursor: isResizing ? 'col-resize' : undefined }}
        >
          <div className={cn('h-8 w-0.5 rounded-full', isResizing ? 'bg-primary' : 'bg-muted-foreground/30')} />
        </div>
      )}

      {/* Right: Preview Panel */}
      <AnimatePresence>
        {canShowPreviewPanel && showPreviewPanel && (
          <motion.div
            ref={previewPanelRef}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            style={{ width: `${previewPanelPercent}%` }}
            className={stoSplitPreviewPaneClass}
          >
            <ChatPreviewPanel
              files={previewableFiles}
              activeFilePath={activePreviewFilePath}
              showEditWorkflow={showEditWorkflow}
              workflowId={sessionWorkflowId}
              onEditWorkflow={openWorkflowPreview}
              className="h-full w-full"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 无 ContentHeader 时：浮动按钮切换预览开/关 */}
      {canShowPreviewPanel ? (
        <button
          type="button"
          onClick={() => {
            if (showPreviewPanel) closePreviewPanel();
            else openPreviewPanel();
          }}
          className="absolute right-4 top-4 z-20 inline-flex h-8 items-center gap-1.5 rounded-full border border-primary/15 bg-white/60 px-3 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-white/80 dark:bg-white/[0.08] dark:hover:bg-white/[0.14]"
        >
          <span>
            {showPreviewPanel
              ? t('chat:preview.collapsePanel')
              : t('chat:toolbar.openPreview')}
          </span>
          {!showPreviewPanel && previewableFiles.length > 0 ? (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] text-primary">
              {previewableFiles.length}
            </span>
          ) : null}
        </button>
      ) : null}
    </div>
  );
}
