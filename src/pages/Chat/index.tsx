/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowDown, Bot, Cpu, Orbit, Sparkles, Workflow } from 'lucide-react';
import { motion } from 'framer-motion';
import { useChatStore, type RawMessage } from '@/stores/chat';
import { useCurrentChatRuntimeView } from '@/stores/chat/runtime-selectors';
import { useChatPreviewPanel } from '@/hooks/use-chat-preview-panel';
import { useGatewayStore } from '@/stores/gateway';
import { resolveAgentById, useAgentsStore } from '@/stores/agents';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ChatMessage } from './ChatMessage';
import { AssistantTurnMessage } from './AssistantTurnMessage';
import { collectSearchableChatMessages, findChatMessageSearchTarget, resolveChatMessageSearchKey } from './chat-message-search';
import { useChatDisplay } from './use-chat-display';
import { isAssistantRole, resolveActiveTurnStableKey } from './chat-display';
import { ChatInput, type FileAttachment } from './ChatInput';
import { ChatEngineSelector, ChatModelSelector } from './ChatEngineModelSelectors';
import { ChatConversationHeaderActions, ChatPreviewWorkspaceHeaderActions } from './ChatSearchBar';
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
  stoPreviewExpandedBodyClass,
  stoSplitRowContentsClass,
} from '@/lib/surfaces';
import { useSplitPanelResize } from '@/hooks/use-split-panel-resize';
import { SplitPanelResizeHandle } from '@/components/layout/split-panel-resize-handle';
import { useSettingsStore } from '@/stores/settings';
import { useChatScrollFollow } from '@/hooks/use-chat-scroll-follow';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { useNativeScrollbarActivity } from '@/hooks/use-native-scrollbar-activity';
import { useMinLoading } from '@/hooks/use-min-loading';
import { useWorkflowCronTaskModal } from '@/hooks/use-workflow-cron-task-modal';
import { TaskCreateModal } from '@/pages/MyTask/components/TaskCreateModal';
import { myTasksWorkflowListHref } from '@/pages/MyTask/constants';
import { useContentHeader } from '@/components/layout/content-header-context';
import { resolveSessionLabel } from '@/lib/session-label';
import { useVoiceLoopStore } from '@/stores/voice-loop';
import { WorkflowCard } from '@/components/workflow/WorkflowCard';
import {
  EMPTY_WORKFLOW_CHAT_CARD_REFS,
  useWorkflowChatCardsStore,
} from '@/stores/workflow-chat-cards';
import {
  attachMissingWorkflowChatCardAnchors,
  workflowAnchorRepairRevision,
} from '@/lib/workflow-chat-card-registration';
import { getCurrentChatDisplayMessages, useCurrentChatDisplayMessages } from '@/stores/chat/display-selectors';
export function Chat() {
  const navigate = useNavigate();
  const { t } = useTranslation('chat');
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const messages = useCurrentChatDisplayMessages();
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const sessions = useChatStore((s) => s.sessions);
  const loading = useChatStore((s) => s.loading);
  const {
    sending,
    pendingFinal,
    lastEventAt: canonicalLastEventAt,
    lastUserMessageAt,
    streamingMessage,
    streamingMessages,
    streamingToolResults,
    streamingTools,
    error,
  } = useCurrentChatRuntimeView();
  const showThinking = useChatStore((s) => s.showThinking);
  const toggleThinking = useChatStore((s) => s.toggleThinking);
  const refresh = useChatStore((s) => s.refresh);
  const sessionLabels = useChatStore((s) => s.sessionLabels);
  const lastChatEventAt = canonicalLastEventAt;
  const abortRun = useChatStore((s) => s.abortRun);
  const clearError = useChatStore((s) => s.clearError);
  const agents = useAgentsStore((s) => s.agents);
  const workflowCards = useWorkflowChatCardsStore(
    (state) => state.refsBySessionKey[currentSessionKey],
  ) ?? EMPTY_WORKFLOW_CHAT_CARD_REFS;
  const loadWorkflowCards = useWorkflowChatCardsStore((s) => s.loadSession);

  const cleanupEmptySession = useChatStore((s) => s.cleanupEmptySession);

  // ── Message Queue ──
  const queue = useMessageQueueStore((s) => s.getQueue(currentSessionKey));
  const queueRemove = useCallback((id: string) => useMessageQueueStore.getState().remove(currentSessionKey, id), [currentSessionKey]);
  const queueMoveUp = useCallback((id: string) => useMessageQueueStore.getState().moveUp(currentSessionKey, id), [currentSessionKey]);
  const queueMoveDown = useCallback((id: string) => useMessageQueueStore.getState().moveDown(currentSessionKey, id), [currentSessionKey]);

  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const previewPanelPercent = useSettingsStore((s) => s.previewSplitPercent ?? 50);
  const setPreviewSplitPercent = useSettingsStore((s) => s.setPreviewSplitPercent);
  const { splitRowRef, previewPanelRef, startResize, adjustPreviewPercent, isResizing } = useSplitPanelResize(
    previewPanelPercent,
    setPreviewSplitPercent,
  );
  const [editDraft, setEditDraft] = useState<{
    text: string;
    skill?: import('@/types/skill-meta').SkillMeta;
    version: number;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchableMessages, setSearchableMessages] = useState<Array<{ key: string; text: string }>>([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const deferredSearchQuery = useDeferredValue(searchQuery.trim());
  const minLoading = useMinLoading(loading && messages.length > 0);
  const { contentRef, scrollRef, scrollToBottom, stopScroll } = useStickToBottomInstant(currentSessionKey);
  useNativeScrollbarActivity(scrollRef);
  const currentSession = useMemo(
    () => sessions.find((session) => session.key === currentSessionKey),
    [sessions, currentSessionKey],
  );
  const currentAgent = useMemo(
    () => resolveAgentById(agents, currentAgentId),
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

  // Load data when gateway is running.
  // When the store already holds messages for this session (i.e. the user
  // is navigating *back* to Chat), use quiet mode so the existing messages
  // stay visible while fresh data loads in the background.  This avoids
  // an unnecessary messages → spinner → messages flicker.
  const anchorRepairRevision = workflowAnchorRepairRevision(messages, workflowCards);
  useEffect(() => {
    return () => {
      // If the user navigates away without sending any messages, remove the
      // empty session so it doesn't linger as a ghost entry in the sidebar.
      cleanupEmptySession();
    };
  }, [cleanupEmptySession]);

  useEffect(() => {
    if (currentSessionKey) void loadWorkflowCards(currentSessionKey);
  }, [currentSessionKey, loadWorkflowCards]);

  useEffect(() => {
    if (!currentSessionKey || sending) return;
    // A chat launch is persisted by Main before the turn is acknowledged.
    // Refresh refs at the turn boundary so discovery does not depend on the
    // workflow tool-result event reaching the renderer.
    void loadWorkflowCards(currentSessionKey, true);
  }, [currentSessionKey, sending, loadWorkflowCards]);

  useEffect(() => {
    if (!currentSessionKey || workflowCards.every((card) => card.anchorUserMessageId)) return;
    void attachMissingWorkflowChatCardAnchors({
      sessionKey: currentSessionKey,
      messages,
      cards: workflowCards,
    });
    // The compact revision captures only anchor-relevant message/card changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionKey, anchorRepairRevision]);

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
    workflowCards,
    lastChatEventAt,
    streamMsg,
    streamText,
    streamingMessages,
    streamingToolResults,
    streamingTools,
    lastUserMessageAt,
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

  const voiceLoopActive = useVoiceLoopStore((s) => s.active);

  const { beginSendScroll, scrollToLatest } = useChatScrollFollow({
    scrollRef,
    contentRef,
    scrollToBottom,
    stopScroll,
    sending,
    lastUserMessageAt,
    hasStreamContent: hasAnyStreamContent || !!activeTurn,
    streamContentKey,
    // 语音循环下输入面板较高：发送后额外滚动，避免气泡底边被面板裁切
    voiceComposerElevated: voiceLoopActive,
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
    if (!isSearchOpen) return;

    const contentElement = contentRef.current;
    if (!contentElement) {
      setSearchableMessages([]);
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      setSearchableMessages(collectSearchableChatMessages(contentElement));
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isSearchOpen, contentRef, currentSessionKey, streamContentKey, showThinking, staticItems, activeTurn]);

  const searchMatches = useMemo(() => {
    if (!deferredSearchQuery) return [];
    const normalizedQuery = deferredSearchQuery.toLocaleLowerCase();
    return searchableMessages.filter((entry) => entry.text.toLocaleLowerCase().includes(normalizedQuery));
  }, [deferredSearchQuery, searchableMessages]);

  const boundedActiveSearchIndex = searchMatches.length > 0
    ? Math.min(activeSearchIndex, searchMatches.length - 1)
    : 0;
  const activeSearchMatch = searchMatches[boundedActiveSearchIndex] ?? null;
  const matchedMessageKeys = useMemo(
    () => new Set(searchMatches.map((entry) => entry.key)),
    [searchMatches],
  );

  const scrollToMessageMatch = useCallback((searchKey: string, behavior: ScrollBehavior = 'smooth') => {
    const container = scrollRef.current;
    const contentElement = contentRef.current;
    if (!container || !contentElement) return;

    const target = findChatMessageSearchTarget(contentElement, searchKey);
    if (!target) return;

    stopScroll();
    const delta = target.getBoundingClientRect().top - container.getBoundingClientRect().top - 28;
    container.scrollBy({ top: delta, behavior });
  }, [contentRef, scrollRef, stopScroll]);

  useEffect(() => {
    if (!activeSearchMatch || !deferredSearchQuery) return;
    scrollToMessageMatch(activeSearchMatch.key, 'smooth');
  }, [activeSearchMatch, deferredSearchQuery, scrollToMessageMatch]);

  const handleSearchNext = useCallback(() => {
    if (searchMatches.length === 0) return;
    setActiveSearchIndex((boundedActiveSearchIndex + 1) % searchMatches.length);
  }, [boundedActiveSearchIndex, searchMatches.length]);

  const handleSearchPrevious = useCallback(() => {
    if (searchMatches.length === 0) return;
    setActiveSearchIndex((boundedActiveSearchIndex - 1 + searchMatches.length) % searchMatches.length);
  }, [boundedActiveSearchIndex, searchMatches.length]);

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
    skillMeta?: import('@/types/skill-meta').SkillMeta,
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
      skillMeta,
    });
  }, [beginSendScroll]);

  const handleQueue = useCallback((
    text: string,
    attachments?: FileAttachment[],
    targetAgentId?: string | null,
    dingTalkMentions?: DingTalkMention[],
    workflowId?: string | null,
    skillMeta?: import('@/types/skill-meta').SkillMeta,
  ) => {
    const { currentSessionKey } = useChatStore.getState();
    useMessageQueueStore.getState().enqueue(currentSessionKey, text, attachments, targetAgentId, dingTalkMentions, workflowId, skillMeta);
  }, []);

  // Stop: suppress the auto-send that the abort's sending→false would otherwise trigger,
  // keeping any queued messages for the next successful run instead of firing them now.
  const handleStop = useCallback(() => {
    const state = useChatStore.getState();
    suspendAutoSend(state.currentSessionKey);
    const turnKey =
      activeTurn?.turnStableKey
      ?? resolveActiveTurnStableKey(getCurrentChatDisplayMessages());
    if (turnKey) {
      markTurnInterrupted(turnKey);
    }
    void abortRun();
  }, [abortRun, activeTurn?.turnStableKey]);

  const handleEditMessage = useCallback(
    (text: string, skillMeta?: import('@/types/skill-meta').SkillMeta) => {
      const trimmed = text.trim();
      if (!trimmed && !skillMeta) return;
      setEditDraft({ text: trimmed, skill: skillMeta, version: Date.now() });
    },
    [],
  );

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
    previewMode,
    showPreviewPanel,
    isPreviewSplit,
    isPreviewExpanded,
    activePreviewFilePath,
    setActivePreviewFilePath,
    previewableFiles,
    canShowPreviewPanel,
    openArtifactPreview,
    openPreviewPanel,
    closePreviewPanel,
    expandPreview,
    restorePreview,
    dismissPreviewFile,
    showEditWorkflow,
    workflowId: sessionWorkflowId,
  } = useChatPreviewPanel(allMessagesForPreview, currentSessionKey);

  const openWorkflowPreview = useCallback((workflowId: string) => {
    navigate(`/workflow/${encodeURIComponent(workflowId)}`);
  }, [navigate]);
  const openWorkflowList = useCallback((workflowId: string) => {
    navigate(myTasksWorkflowListHref(workflowId));
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

  const conversationHeaderActions = useMemo(
    () => (
      <ChatConversationHeaderActions
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
            setActiveSearchIndex(0);
            if (!isSearchOpen) {
              setIsSearchOpen(true);
            }
          },
          onNext: handleSearchNext,
          onPrevious: handleSearchPrevious,
          onClear: handleSearchClear,
          resultCount: searchMatches.length,
          activeIndex: boundedActiveSearchIndex,
        }}
      />
    ),
    [
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
      boundedActiveSearchIndex,
    ],
  );

  const previewHeaderActions = useMemo(
    () => (
      <ChatPreviewWorkspaceHeaderActions
        canShowPreviewPanel={canShowPreviewPanel}
        isPreviewPanelOpen={showPreviewPanel}
        isWorkspaceExpanded={isPreviewExpanded}
        onExpandWorkspace={expandPreview}
        onRestoreWorkspace={restorePreview}
        onTogglePreview={() => {
          if (showPreviewPanel) closePreviewPanel();
          else openPreviewPanel();
        }}
      />
    ),
    [
      canShowPreviewPanel,
      showPreviewPanel,
      isPreviewExpanded,
      expandPreview,
      restorePreview,
      closePreviewPanel,
      openPreviewPanel,
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
    chatActions: conversationHeaderActions,
    previewActions: previewHeaderActions,
    layoutMode:
      !canShowPreviewPanel || previewMode === 'closed'
        ? 'conversation'
        : previewMode === 'expanded'
          ? 'preview-expanded'
          : 'split',
  });

  const isSplitChatLayout = isPreviewSplit;
  const showPreviewSurface = canShowPreviewPanel && showPreviewPanel;

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
        isSplitChatLayout
          ? stoSplitRowContentsClass
          : isPreviewExpanded
            ? 'flex min-h-0 flex-1 flex-col'
            : 'flex flex-row',
      )}
    >
      {/* Left: Chat area */}
      <ChatConversationColumn
        variant="page"
        isSplitLayout={isSplitChatLayout}
        isPreviewExpanded={isPreviewExpanded}
        splitGridChatClass={isSplitChatLayout ? stoSplitGridBodyChatClass : undefined}
        className={cn(
          !isSplitChatLayout
            && !isPreviewExpanded
            && 'pt-[var(--sto-conversation-header-to-surface-gap,0px)]',
        )}
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
          'relative z-10 min-h-0 flex-1',
          'pt-[var(--sto-workbench-body-content-inset-y,8px)] pb-4',
          isSplitChatLayout
            ? stoSplitChatScrollClass
            : 'sto-thin-scrollbar overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable]',
        )}
      >
        <div ref={contentRef} className={stoChatScrollContentClass}>
          {isEmpty ? (
            <WelcomeScreen />
          ) : (
            <>
              {staticItems.map((item) => {
                if (item.type === 'workflow-run') {
                  return (
                    <WorkflowCard
                      key={item.key}
                      runId={item.card.runId}
                      templateName={item.card.title}
                      paramsSummary={item.card.paramsSummary}
                      onPreviewArtifact={openArtifactPreview}
                      onCreateScheduledTask={openWorkflowCronTaskModal}
                      onOpenWorkflow={openWorkflowList}
                    />
                  );
                }
                if (item.type === 'assistant-turn') {
                  return (
                    <AssistantTurnMessage
                      key={item.key}
                      sessionMessages={messages}
                      turnMessages={item.messages}
                      turnToolResults={item.toolResults}
                      precedingUserMessage={item.precedingUserMessage}
                      turnStableKey={item.key}
                      showThinking={showThinking}
                      matchedMessageKeys={matchedMessageKeys}
                      activeMessageKey={activeSearchMatch?.key ?? null}
                      onPreviewFile={openArtifactPreview}
                      onCreateScheduledTask={openWorkflowCronTaskModal}
                      onEditMessage={handleEditMessage}
                    />
                  );
                }
                const searchMessageKey = resolveChatMessageSearchKey(
                  item.message.id,
                  `single:${item.key}`,
                );
                return (
                  <ChatMessage
                    key={item.key}
                    message={item.message}
                    sessionMessages={messages}
                    showThinking={showThinking}
                    searchMessageKey={searchMessageKey}
                    isSearchMatch={matchedMessageKeys.has(searchMessageKey)}
                    isSearchActive={searchMessageKey === activeSearchMatch?.key}
                    onPreviewFile={openArtifactPreview}
                    onCreateScheduledTask={openWorkflowCronTaskModal}
                    onEditMessage={handleEditMessage}
                    isTurnDisplayReply={isAssistantRole(item.message.role)}
                  />
                );
              })}

              {activeTurn ? (
                <AssistantTurnMessage
                  key={`active-turn:${currentSessionKey}`}
                  sessionMessages={messages}
                  turnMessages={activeTurn.turnMessages}
                  turnToolResults={activeTurn.turnToolResults}
                  precedingUserMessage={activeTurn.precedingUserMessage}
                  turnStableKey={activeTurn.turnStableKey}
                  showThinking={showThinking}
                  matchedMessageKeys={matchedMessageKeys}
                  activeMessageKey={activeSearchMatch?.key ?? null}
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
        editDraft={editDraft}
        onEditDraftApplied={handleEditDraftApplied}
        composerLayout="home"
        toolbarInlineSelectors={(
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <ChatEngineSelector variant="inline" className="min-w-0 flex-1" />
            <ChatModelSelector variant="inline" className="min-w-max shrink-0" />
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
      {/* Preview — Handle 仅 split；expanded 保持 Conversation 挂载 */}
      {showPreviewSurface ? (
        <div
          ref={previewPanelRef}
          className={cn(
            isSplitChatLayout && stoSplitGridBodyPreviewClass,
            isPreviewExpanded && stoPreviewExpandedBodyClass,
          )}
        >
          {isSplitChatLayout ? (
            <SplitPanelResizeHandle
              valuePercent={previewPanelPercent}
              isResizing={isResizing}
              onResizeStart={startResize}
              onKeyboardAdjust={adjustPreviewPercent}
            />
          ) : null}
          <ChatPreviewPanel
            files={previewableFiles}
            activeFilePath={activePreviewFilePath}
            showEditWorkflow={showEditWorkflow}
            workflowId={sessionWorkflowId}
            onEditWorkflow={openWorkflowPreview}
            className="h-full w-full"
          />
        </div>
      ) : null}
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
