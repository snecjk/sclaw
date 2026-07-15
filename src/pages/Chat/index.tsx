/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowDown, Bot, Cpu, Loader2, Orbit, Sparkles, Workflow } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useChatStore, type RawMessage } from '@/stores/chat';
import { useChatPreviewPanel } from '@/hooks/use-chat-preview-panel';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ChatMessage } from './ChatMessage';
import { AssistantTurnMessage } from './AssistantTurnMessage';
import { useChatDisplay } from './use-chat-display';
import { isAssistantRole, resolveActiveTurnStableKey } from './chat-display';
import { ChatInput, type FileAttachment } from './ChatInput';
import { ChatEngineSelector, ChatModelSelector } from './ChatEngineModelSelectors';
import { ChatContentHeaderActions } from './ChatSearchBar';
import { ChatPreviewHeaderTabs } from './ChatPreviewHeaderTabs';
import { PendingQueuePanel } from './PendingQueuePanel';
import { ParameterFormDock } from '@/components/parameter-form/ParameterFormDock';
import { ChatPreviewPanel } from './ChatPreviewPanel';
import { extractText } from './message-utils';
import { useMessageQueueStore, createAutoSendWatcher, suspendAutoSend } from '@/stores/message-queue';
import { markTurnInterrupted } from '@/lib/turn-interrupt-marker';
import type { DingTalkMention } from '@/types/dingtalk-mention';
import { useTranslation } from 'react-i18next';
import { resolveChatSessionEngineType } from '@/lib/resolve-chat-session-engine-type';
import { cn } from '@/lib/utils';
import { ChatConversationColumn } from '@/components/chat/chat-conversation-column';
import {
  stoParameterFormDockLayout,
  stoSplitChatScrollClass,
  stoChatScrollContentClass,
  stoSplitGridBodyChatClass,
  stoSplitGridBodyPreviewClass,
  stoSplitGridBodyResizerClass,
  stoSplitResizerActiveClass,
  stoSplitRowContentsClass,
} from '@/lib/surfaces';
import { useSplitPanelResize } from '@/hooks/use-split-panel-resize';
import { useSettingsStore } from '@/stores/settings';
import { useChatScrollFollow } from '@/hooks/use-chat-scroll-follow';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { useMinLoading } from '@/hooks/use-min-loading';
import { useBuiltinToolListener } from '@/hooks/use-builtin-tool-listener';
import { useWorkflowCronTaskModal } from '@/hooks/use-workflow-cron-task-modal';
import { TaskCreateModal } from '@/pages/MyTask/components/TaskCreateModal';
import { useContentHeader } from '@/components/layout/content-header-context';
import { resolveSessionLabel } from '@/lib/session-label';
export function Chat() {
  useBuiltinToolListener();
  const navigate = useNavigate();
  const { t } = useTranslation('chat');
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const messages = useChatStore((s) => s.messages);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const sessions = useChatStore((s) => s.sessions);
  const loading = useChatStore((s) => s.loading);
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const showThinking = useChatStore((s) => s.showThinking);
  const toggleThinking = useChatStore((s) => s.toggleThinking);
  const refresh = useChatStore((s) => s.refresh);
  const sessionLabels = useChatStore((s) => s.sessionLabels);
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const streamingMessages = useChatStore((s) => s.streamingMessages);
  const streamingToolResults = useChatStore((s) => s.streamingToolResults);
  const streamingTools = useChatStore((s) => s.streamingTools);
  const pendingFinal = useChatStore((s) => s.pendingFinal);
  const lastChatEventAt = useChatStore((s) => s.lastChatEventAt);
  const lastUserMessageAt = useChatStore((s) => s.lastUserMessageAt);
  const abortRun = useChatStore((s) => s.abortRun);
  const clearError = useChatStore((s) => s.clearError);
  const agents = useAgentsStore((s) => s.agents);

  const cleanupEmptySession = useChatStore((s) => s.cleanupEmptySession);

  // ── Message Queue ──
  const queue = useMessageQueueStore((s) => s.getQueue(currentSessionKey));
  const queueRemove = useCallback((id: string) => useMessageQueueStore.getState().remove(currentSessionKey, id), [currentSessionKey]);
  const queueMoveUp = useCallback((id: string) => useMessageQueueStore.getState().moveUp(currentSessionKey, id), [currentSessionKey]);
  const queueMoveDown = useCallback((id: string) => useMessageQueueStore.getState().moveDown(currentSessionKey, id), [currentSessionKey]);

  const [streamingTimestamp, setStreamingTimestamp] = useState<number>(0);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const previewPanelPercent = useSettingsStore((s) => s.previewSplitPercent ?? 50);
  const setPreviewSplitPercent = useSettingsStore((s) => s.setPreviewSplitPercent);
  const { splitRowRef, previewPanelRef, startResize, isResizing } = useSplitPanelResize(
    previewPanelPercent,
    setPreviewSplitPercent,
  );
  const [editDraft, setEditDraft] = useState<{ text: string; version: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchableMessages, setSearchableMessages] = useState<Array<{ id: string; text: string }>>([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const deferredSearchQuery = useDeferredValue(searchQuery.trim());
  const minLoading = useMinLoading(loading && messages.length > 0);
  const { contentRef, scrollRef, scrollToBottom, stopScroll } = useStickToBottomInstant(currentSessionKey);
  const currentSession = useMemo(
    () => sessions.find((session) => session.key === currentSessionKey),
    [sessions, currentSessionKey],
  );
  const currentAgent = useMemo(
    () => agents.find((agent) => agent.id === currentAgentId),
    [agents, currentAgentId],
  );
  const currentEngineType = resolveChatSessionEngineType(
    currentSession,
    currentAgent?.engineType,
    currentSessionKey,
    { messageCount: messages.length },
  );
  const composerRequiresGateway = currentEngineType === 'openclaw';
  const composerDisabled = composerRequiresGateway && !isGatewayRunning;
  const composerStatusText = currentEngineType === 'claude'
    ? t('composer.claudeReadyDetail')
    : t('composer.gatewayStatus', {
        state: gatewayStatus.state === 'running'
          ? t('composer.gatewayConnected')
          : gatewayStatus.state,
        port: gatewayStatus.port,
        pid: gatewayStatus.pid ? `| pid: ${gatewayStatus.pid}` : '',
      });
  const composerStatusTone = currentEngineType === 'claude' || isGatewayRunning ? 'ready' : 'warning';

  // Load data when gateway is running.
  // When the store already holds messages for this session (i.e. the user
  // is navigating *back* to Chat), use quiet mode so the existing messages
  // stay visible while fresh data loads in the background.  This avoids
  // an unnecessary messages → spinner → messages flicker.
  useEffect(() => {
    return () => {
      // If the user navigates away without sending any messages, remove the
      // empty session so it doesn't linger as a ghost entry in the sidebar.
      cleanupEmptySession();
    };
  }, [cleanupEmptySession]);

  // Update timestamp when sending starts
  useEffect(() => {
    if (sending && streamingTimestamp === 0) {
       
      setStreamingTimestamp(Date.now() / 1000);
    } else if (!sending && streamingTimestamp !== 0) {
      setStreamingTimestamp(0);
    }
  }, [sending, streamingTimestamp]);

  // Gateway not running block has been completely removed so the UI always renders.

  const streamMsg = streamingMessage && typeof streamingMessage === 'object'
    ? streamingMessage as unknown as { role?: string; content?: unknown; timestamp?: number; id?: string }
    : null;
  const streamText = streamMsg ? extractText(streamMsg) : (typeof streamingMessage === 'string' ? streamingMessage : '');

  const { staticItems, activeTurn, shouldRenderStreaming, hasAnyStreamContent } = useChatDisplay({
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

  const streamContentKey = useMemo(
    () =>
      [
        messages.length,
        staticItems.length,
        activeTurn ? 1 : 0,
        streamText.length,
        streamingMessages.length,
        streamingToolResults.length,
        streamingTools.length,
        pendingFinal ? 1 : 0,
        shouldRenderStreaming ? 1 : 0,
      ].join(':'),
    [
      messages.length,
      staticItems.length,
      activeTurn,
      streamText.length,
      streamingMessages.length,
      streamingToolResults.length,
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
    sending,
    lastUserMessageAt,
    hasStreamContent: hasAnyStreamContent || !!activeTurn,
    streamContentKey,
  });

  const isEmpty = messages.length === 0 && !sending;

  const updateJumpToLatestVisibility = useCallback(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) {
      setShowJumpToLatest(false);
      return;
    }

    const distanceFromBottom = scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight;
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
  }, [currentSessionKey, scrollRef, updateJumpToLatestVisibility]);

  useEffect(() => {
    updateJumpToLatestVisibility();
  }, [messages.length, shouldRenderStreaming, pendingFinal, updateJumpToLatestVisibility]);

  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) {
      setSearchableMessages([]);
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const nodes = Array.from(contentElement.querySelectorAll<HTMLElement>('[data-chat-message-id]'));
      const nextSearchableMessages = nodes
        .map((node) => ({
          id: node.dataset.chatMessageId?.trim() ?? '',
          text: (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim(),
        }))
        .filter((entry) => entry.id.length > 0 && entry.text.length > 0);
      setSearchableMessages(nextSearchableMessages);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [contentRef, currentSessionKey, streamContentKey, showThinking, staticItems, activeTurn]);

  const searchMatches = useMemo(() => {
    if (!deferredSearchQuery) return [];
    const normalizedQuery = deferredSearchQuery.toLocaleLowerCase();
    return searchableMessages.filter((entry) => entry.text.toLocaleLowerCase().includes(normalizedQuery));
  }, [deferredSearchQuery, searchableMessages]);

  useEffect(() => {
    setActiveSearchIndex(0);
  }, [deferredSearchQuery]);

  useEffect(() => {
    if (searchMatches.length === 0) {
      setActiveSearchIndex(0);
      return;
    }
    setActiveSearchIndex((currentIndex) => Math.min(currentIndex, searchMatches.length - 1));
  }, [searchMatches]);

  const activeSearchMatch = searchMatches[activeSearchIndex] ?? null;
  const matchedMessageIds = useMemo(
    () => new Set(searchMatches.map((entry) => entry.id)),
    [searchMatches],
  );

  const scrollToMessageMatch = useCallback((messageId: string, behavior: ScrollBehavior = 'smooth') => {
    const container = scrollRef.current;
    const contentElement = contentRef.current;
    if (!container || !contentElement) return;

    const target = Array.from(contentElement.querySelectorAll<HTMLElement>('[data-chat-message-id]'))
      .find((node) => node.dataset.chatMessageId === messageId);
    if (!target) return;

    stopScroll();
    const delta = target.getBoundingClientRect().top - container.getBoundingClientRect().top - 28;
    container.scrollBy({ top: delta, behavior });
  }, [contentRef, scrollRef, stopScroll]);

  useEffect(() => {
    if (!activeSearchMatch || !deferredSearchQuery) return;
    scrollToMessageMatch(activeSearchMatch.id, 'smooth');
  }, [activeSearchMatch, deferredSearchQuery, scrollToMessageMatch]);

  const handleSearchNext = useCallback(() => {
    if (searchMatches.length === 0) return;
    setActiveSearchIndex((currentIndex) => (currentIndex + 1) % searchMatches.length);
  }, [searchMatches.length]);

  const handleSearchPrevious = useCallback(() => {
    if (searchMatches.length === 0) return;
    setActiveSearchIndex((currentIndex) => (currentIndex - 1 + searchMatches.length) % searchMatches.length);
  }, [searchMatches.length]);

  const handleSearchClear = useCallback(() => {
    setSearchQuery('');
    setActiveSearchIndex(0);
  }, []);

  const handleSearchToggle = useCallback(() => {
    setIsSearchOpen((current) => !current);
  }, []);

  const handleSend = useCallback(async (
    text: string,
    attachments?: import('./ChatInput').FileAttachment[],
    targetAgentId?: string | null,
    dingTalkMentions?: import('@/types/dingtalk-mention').DingTalkMention[],
    workflowId?: string | null,
    workflowSource?: string | null,
    workflowName?: string | null,
  ) => {
    beginSendScroll();
    const { dispatchChatSend } = await import('@/hooks/dispatch-chat-send');
    await dispatchChatSend({
      text,
      attachments,
      targetAgentId,
      dingTalkMentions,
      workflowId,
      workflowSource,
      workflowName,
      skipQuestionSplit: !!(dingTalkMentions && dingTalkMentions.length > 0),
      onSplittingChange: setSplitting,
    });
  }, [beginSendScroll]);

  const handleQueue = useCallback((
    text: string,
    attachments?: FileAttachment[],
    targetAgentId?: string | null,
    dingTalkMentions?: DingTalkMention[],
    workflowId?: string | null,
  ) => {
    const { currentSessionKey } = useChatStore.getState();
    useMessageQueueStore.getState().enqueue(currentSessionKey, text, attachments, targetAgentId, dingTalkMentions, workflowId);
  }, []);

  // Stop: suppress the auto-send that the abort's sending→false would otherwise trigger,
  // keeping any queued messages for the next successful run instead of firing them now.
  const handleStop = useCallback(() => {
    const state = useChatStore.getState();
    suspendAutoSend(state.currentSessionKey);
    const turnKey =
      activeTurn?.turnStableKey
      ?? resolveActiveTurnStableKey(state.messages);
    if (turnKey) {
      markTurnInterrupted(turnKey);
    }
    void abortRun();
  }, [abortRun, activeTurn?.turnStableKey]);

  const handleEditMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setEditDraft({ text: trimmed, version: Date.now() });
  }, []);

  const handleEditDraftApplied = useCallback(() => {
    setEditDraft(null);
  }, []);

  // Collect previewable files from messages and streaming message
  const allMessagesForPreview = useMemo(() => {
    const arr = [...messages] as RawMessage[];
    if (streamMsg) {
      arr.push(streamMsg as unknown as RawMessage);
    }
    return arr;
  }, [messages, streamMsg]);

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
  } = useChatPreviewPanel(allMessagesForPreview, currentSessionKey);

  const openWorkflowPreview = useCallback((workflowId: string) => {
    navigate(`/workflow/${encodeURIComponent(workflowId)}`);
  }, [navigate]);

  const {
    open: workflowCronModalOpen,
    initialValues: workflowCronInitialValues,
    openForWorkflow: openWorkflowCronTaskModal,
    close: closeWorkflowCronTaskModal,
    handleSave: handleWorkflowCronTaskSave,
  } = useWorkflowCronTaskModal();

  const sessionTitle = useMemo(
    () => resolveSessionLabel({
      key: currentSessionKey,
      displayName: currentSession?.displayName,
      label: currentSession?.label,
      sessionLabels,
      t,
    }),
    [currentSessionKey, currentSession?.displayName, currentSession?.label, sessionLabels, t],
  );

  const headerActions = useMemo(
    () => (
      <ChatContentHeaderActions
        canShowPreviewPanel={canShowPreviewPanel}
        isPreviewPanelOpen={showPreviewPanel}
        onTogglePreview={() => {
          if (showPreviewPanel) closePreviewPanel();
          else openPreviewPanel();
        }}
        showThinking={showThinking}
        onToggleThinking={toggleThinking}
        loading={loading}
        onRefresh={refresh}
        searchProps={{
          isOpen: isSearchOpen,
          onToggle: handleSearchToggle,
          value: searchQuery,
          onChange: (value) => {
            setSearchQuery(value);
            if (!isSearchOpen) {
              setIsSearchOpen(true);
            }
          },
          onNext: handleSearchNext,
          onPrevious: handleSearchPrevious,
          onClear: handleSearchClear,
          resultCount: searchMatches.length,
          activeIndex: searchMatches.length > 0 ? activeSearchIndex : 0,
        }}
      />
    ),
    [
      canShowPreviewPanel,
      showPreviewPanel,
      closePreviewPanel,
      openPreviewPanel,
      showThinking,
      toggleThinking,
      loading,
      refresh,
      isSearchOpen,
      handleSearchToggle,
      searchQuery,
      handleSearchNext,
      handleSearchPrevious,
      handleSearchClear,
      searchMatches.length,
      activeSearchIndex,
    ],
  );

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
    title: sessionTitle,
    previewTabs: previewHeaderTabs,
    actions: headerActions,
    isSplitLayout: canShowPreviewPanel && showPreviewPanel,
  });

  const isSplitChatLayout = canShowPreviewPanel && showPreviewPanel;

  // Auto-send watcher: sends queued messages one-by-one when AI finishes responding
  useEffect(() => {
    const unsub = createAutoSendWatcher(() => scrollToLatest('auto'));
    return unsub;
  }, [scrollToLatest]);

  return (
    <>
    <div
      ref={splitRowRef}
      className={cn(
        'relative h-full min-h-0 min-w-0 flex-1 overflow-x-hidden transition-colors duration-500',
        isSplitChatLayout ? stoSplitRowContentsClass : 'flex flex-row',
      )}
    >
      {/* Left: Chat area */}
      <ChatConversationColumn
        variant="page"
        isSplitLayout={isSplitChatLayout}
        splitGridChatClass={isSplitChatLayout ? stoSplitGridBodyChatClass : undefined}
      >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,140,0,0.06),_transparent_30%),radial-gradient(circle_at_80%_20%,_rgba(229,230,235,0.35),_transparent_26%)]" />
        <div className="absolute inset-0 neural-grid opacity-20" />
        <div className="absolute left-8 top-10 h-40 w-40 rounded-full bg-cyan-400/10 blur-[90px]" />
        <div className="absolute right-8 top-20 h-48 w-48 rounded-full bg-[rgba(255,111,0,0.06)] blur-[110px]" />
      </div>

      {/* Messages Area */}
      <div
        ref={scrollRef}
        className={cn(
          'relative z-10 min-h-0 flex-1 py-4',
          isSplitChatLayout
            ? stoSplitChatScrollClass
            : 'overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable]',
        )}
      >
        <div ref={contentRef} className={stoChatScrollContentClass}>
          {isEmpty ? (
            <WelcomeScreen />
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
                      matchedMessageIds={matchedMessageIds}
                      activeMessageId={activeSearchMatch?.id ?? null}
                      onPreviewFile={openArtifactPreview}
                      onCreateScheduledTask={openWorkflowCronTaskModal}
                      onEditMessage={handleEditMessage}
                    />
                  );
                }
                return (
                  <ChatMessage
                    key={item.key}
                    message={item.message}
                    showThinking={showThinking}
                    isSearchMatch={!!item.message.id && matchedMessageIds.has(item.message.id)}
                    isSearchActive={!!item.message.id && item.message.id === activeSearchMatch?.id}
                    onPreviewFile={openArtifactPreview}
                    onCreateScheduledTask={openWorkflowCronTaskModal}
                    onEditMessage={handleEditMessage}
                    isTurnDisplayReply={isAssistantRole(item.message.role)}
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
                  matchedMessageIds={matchedMessageIds}
                  activeMessageId={activeSearchMatch?.id ?? null}
                  activeStream={activeTurn.activeStream}
                  onPreviewFile={openArtifactPreview}
                  onCreateScheduledTask={openWorkflowCronTaskModal}
                  onEditMessage={handleEditMessage}
                />
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Error bar */}
      {error && (
        <div className="bg-destructive/10 border-t border-destructive/20 py-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {error}
            </p>
            <button
              onClick={clearError}
              className="text-xs text-destructive/60 hover:text-destructive underline"
            >
              {t('common:actions.dismiss')}
            </button>
          </div>
        </div>
      )}

      {/* Jump to latest — 仅在有提示时占位，高度贴齐按钮 */}
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
            <ArrowDown className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />
            <span>{t('streaming.jumpToLatest')}</span>
          </motion.button>
        </div>
      </div>

      {/* Splitting indicator */}
      <AnimatePresence>
        {splitting && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="shrink-0"
          >
            <div className="flex items-center gap-2 rounded-lg border border-border bg-white/50 px-3 py-2 text-xs text-muted-foreground backdrop-blur-sm dark:bg-white/[0.06]">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span>{t('splitting')}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pending Message Queue */}
      <PendingQueuePanel
        sessionKey={currentSessionKey}
        queue={queue}
        onRemove={queueRemove}
        onMoveUp={queueMoveUp}
        onMoveDown={queueMoveDown}
      />

      {/* Parameter form dock — 任务二：吸附输入框上方固定浮层 */}
      <div className="relative z-10 w-full shrink-0">
        <ParameterFormDock layout={stoParameterFormDockLayout('page')} />
      </div>

      {/* Input Area */}
      <ChatInput
        onSend={handleSend}
        onStop={handleStop}
        onQueue={handleQueue}
        disabled={composerDisabled}
        sending={sending}
        isEmpty={isEmpty}
        engineType={currentEngineType}
        statusText={composerStatusText}
        statusTone={composerStatusTone}
        editDraft={editDraft}
        onEditDraftApplied={handleEditDraftApplied}
        composerLayout="home"
        toolbarInlineSelectors={(
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <ChatEngineSelector variant="inline" className="min-w-0 flex-1" />
            <ChatModelSelector variant="inline" className="min-w-0 flex-1" />
          </div>
        )}
      />

      {/* Transparent loading overlay */}
      {minLoading && !sending && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/10 dark:bg-black/10 backdrop-blur-[2px] rounded-xl pointer-events-auto">
          <div className="glass shadow-glass rounded-full p-2.5 border border-glass-border">
            <LoadingSpinner size="md" />
          </div>
        </div>
      )}
      </ChatConversationColumn>
      {/* Resizer */}
      {canShowPreviewPanel && showPreviewPanel && (
        <div
          onMouseDown={startResize}
          className={cn(
            stoSplitGridBodyResizerClass,
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
            layout={false}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className={stoSplitGridBodyPreviewClass}
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
    </div>
    <TaskCreateModal
      open={workflowCronModalOpen}
      onClose={closeWorkflowCronTaskModal}
      onSave={handleWorkflowCronTaskSave}
      initialValues={workflowCronInitialValues}
    />
    </>
  );
}

// ── Welcome Screen ──────────────────────────────────────────────

const buttonVariants = {
  hidden: { opacity: 0, y: 12, scale: 0.95 },
  visible: { opacity: 1, y: 0, scale: 1 },
};

function WelcomeScreen() {
  const { t } = useTranslation('chat');
  const quickActions = [
    {
      key: 'askQuestions',
      label: t('welcome.askQuestions'),
      description: t('welcome.askQuestionsDesc'),
      icon: Cpu,
    },
    {
      key: 'creativeTasks',
      label: t('welcome.creativeTasks'),
      description: t('welcome.creativeTasksDesc'),
      icon: Workflow,
    },
    {
      key: 'brainstorming',
      label: t('welcome.brainstorming'),
      description: '让多个助手一起分工，处理更复杂的事情。',
      icon: Bot,
    },
  ];
  const statusItems = [
    { label: '状态', value: '已就绪' },
    { label: '协作', value: '多助手' },
    { label: '工具', value: '可调用' },
  ];

  return (
    <div className="relative flex h-[68vh] flex-col items-center justify-center overflow-hidden text-center">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[18%] h-40 w-40 -translate-x-1/2 rounded-full bg-cyan-300/10 blur-[90px]" />
      </div>

      <div className="relative z-10 flex max-w-4xl flex-col items-center justify-center">
        <motion.div
          className="mb-6 flex flex-wrap items-center justify-center gap-2.5"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
        >
          <span className="glow-badge inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em]">
            <Orbit className="h-3.5 w-3.5" />
            智能助手
          </span>
          <span className="glow-badge inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em]">
            <Sparkles className="h-3.5 w-3.5" />
            灵感工作台
          </span>
          <span className="glow-badge inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em]">
            <Bot className="h-3.5 w-3.5" />
            多助手协作
          </span>
        </motion.div>

        <motion.div
          className="space-y-4"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        >
          <h1 className="text-5xl font-semibold tracking-[-0.05em] text-foreground md:text-6xl">
            {t('welcome.subtitle')}
          </h1>
          <p className="mx-auto max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
            在一个界面里完成对话、调用工具、协作处理和持续执行。
          </p>
        </motion.div>

        <motion.div
          className="mt-10 grid w-full max-w-4xl gap-4 md:grid-cols-3"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.1, delayChildren: 0.35 } },
          }}
        >
          {quickActions.map(({ key, label, description, icon: Icon }) => (
            <motion.button
              key={key}
              className="signal-card rounded-3xl px-5 py-5 text-left transition-transform duration-300 hover:-translate-y-1"
              variants={buttonVariants}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-400/10 text-cyan-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                <Icon className="h-5 w-5" />
              </div>
              <div className="mt-4 text-[11px] font-medium uppercase tracking-[0.22em] text-foreground/45">
                功能
              </div>
              <div className="mt-2 text-lg font-medium text-foreground">
                {label}
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            </motion.button>
          ))}
        </motion.div>

        <motion.div
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut', delay: 0.55 }}
        >
          {statusItems.map((item) => (
            <div
              key={item.label}
              className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3 backdrop-blur-md"
            >
              <div className="text-[11px] uppercase tracking-[0.22em] text-foreground/45">{item.label}</div>
              <div className="mt-1 flex items-center gap-2 text-sm font-medium text-foreground/88">
                <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.7)]" />
                {item.value}
              </div>
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}

export default Chat;
