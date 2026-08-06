import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowDown, Loader2, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useChatStore, type RawMessage } from '@/stores/chat';
import { useChatPreviewPanel } from '@/hooks/use-chat-preview-panel';
import {
  EMPTY_WORKFLOW_CHAT_CARD_REFS,
  useWorkflowChatCardsStore,
} from '@/stores/workflow-chat-cards';
import { WorkflowCard } from '@/components/workflow/WorkflowCard';
import { createAutoSendWatcher } from '@/stores/message-queue';
import { ChatMessage } from '@/pages/Chat/ChatMessage';
import { AssistantTurnMessage } from '@/pages/Chat/AssistantTurnMessage';
import {
  collectSearchableChatMessages,
  findChatMessageSearchTarget,
  resolveChatMessageSearchKey,
} from '@/pages/Chat/chat-message-search';
import { useChatDisplay } from '@/pages/Chat/use-chat-display';
import { extractText } from '@/pages/Chat/message-utils';
import { ChatConversationHeaderActions, ChatPreviewWorkspaceHeaderActions } from '@/pages/Chat/ChatSearchBar';
import { ChatPreviewHeaderTabs } from '@/pages/Chat/ChatPreviewHeaderTabs';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { useMinLoading } from '@/hooks/use-min-loading';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { ChatConversationColumn } from '@/components/chat/chat-conversation-column';
import { OverlayScrollbar } from '@/components/ui/overlay-scrollbar';
import {
  stoChatColumnContentTrackClass,
  stoChatScrollContentClass,
  stoChatScrollPaneClass,
  stoChatScrollPaneSplitClass,
  stoOverlayScrollHostClass,
  stoSplitGridBodyChatClass,
  stoSplitGridBodyPreviewClass,
  stoPreviewExpandedBodyClass,
  stoSplitRowContentsClass,
} from '@/lib/surfaces';
import { useSplitPanelResize } from '@/hooks/use-split-panel-resize';
import { SplitPanelResizeHandle } from '@/components/layout/split-panel-resize-handle';
import { ChatPreviewPanel } from '@/pages/Chat/ChatPreviewPanel';
import { useWorkflowCronTaskModal } from '@/hooks/use-workflow-cron-task-modal';
import { useStoTaskSubitemEntry } from '@/hooks/use-sto-task-subitem-entry';
import { TaskCreateModal } from '@/pages/MyTask/components/TaskCreateModal';
import { myTasksWorkflowListHref } from '@/pages/MyTask/constants';
import { HomeComposer } from '@/pages/Home/HomeComposer';
import type { FileAttachment } from '@/pages/Chat/ChatInput';
import type { DingTalkMention } from '@/types/dingtalk-mention';
import type { SkillMeta } from '@/types/skill-meta';
import { useContentHeader } from '@/components/layout/content-header-context';
import { resolveSessionLabel } from '@/lib/session-label';
import { attachMissingWorkflowChatCardAnchors } from '@/lib/workflow-chat-card-registration';

/**
 * Main-agent conversation thread on the home route (replaces the old `/chat` welcome + messages UI).
 * 三栏预览时输入框与消息同属左侧对话列（与 Chat / 任务子项一致）。
 */
export interface HomeMainConversationProps {
  className?: string;
  /** 一次性填入输入框的种子文案 */
  seedText?: string;
  /** 技能广场「使用」：预填技能标签 */
  seedSkillSlug?: string;
  onSend?: (
    text: string,
    attachments?: FileAttachment[],
    targetAgentId?: string | null,
    dingTalkMentions?: DingTalkMention[],
    workflowId?: string | null,
    workflowSource?: string | null,
    workflowName?: string | null,
    skillMeta?: SkillMeta,
  ) => void;
}

export function HomeMainConversation({ className, seedText, seedSkillSlug, onSend }: HomeMainConversationProps) {
  const navigate = useNavigate();
  const { t } = useTranslation(['chat', 'common']);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessions = useChatStore((s) => s.sessions);
  const sessionLabels = useChatStore((s) => s.sessionLabels);
  const messages = useChatStore((s) => s.messages);
  const loading = useChatStore((s) => s.loading);
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const showThinking = useChatStore((s) => s.showThinking);
  const toggleThinking = useChatStore((s) => s.toggleThinking);
  const refresh = useChatStore((s) => s.refresh);
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const streamingMessages = useChatStore((s) => s.streamingMessages);
  const streamingToolResults = useChatStore((s) => s.streamingToolResults);
  const streamingTools = useChatStore((s) => s.streamingTools);
  const pendingFinal = useChatStore((s) => s.pendingFinal);
  const lastChatEventAt = useChatStore((s) => s.lastChatEventAt);
  const clearError = useChatStore((s) => s.clearError);

  const workflowCards = useWorkflowChatCardsStore(
    (state) => state.refsBySessionKey[currentSessionKey],
  ) ?? EMPTY_WORKFLOW_CHAT_CARD_REFS;
  const loadWorkflowCards = useWorkflowChatCardsStore((state) => state.loadSession);

  useEffect(() => {
    void loadWorkflowCards(currentSessionKey);
  }, [currentSessionKey, loadWorkflowCards]);

  useEffect(() => {
    if (!currentSessionKey || sending) return;
    void loadWorkflowCards(currentSessionKey, true);
  }, [currentSessionKey, sending, loadWorkflowCards]);

  useEffect(() => {
    if (!currentSessionKey || workflowCards.every((card) => card.anchorUserMessageId)) return;
    void attachMissingWorkflowChatCardAnchors({
      sessionKey: currentSessionKey,
      messages,
      cards: workflowCards,
    });
  }, [currentSessionKey, messages, workflowCards]);

  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchableMessages, setSearchableMessages] = useState<Array<{ key: string; text: string }>>([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const { contentRef, scrollRef, scrollToBottom } = useStickToBottomInstant(currentSessionKey);
  const deferredSearchQuery = useDeferredValue(searchQuery.trim());
  const minLoading = useMinLoading(loading && messages.length > 0);

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
  }, [currentSessionKey, scrollRef, updateJumpToLatestVisibility]);

  useEffect(() => {
    const unsub = createAutoSendWatcher(() => scrollToBottom('auto'));
    return unsub;
  }, [scrollToBottom]);

  const streamMsg = streamingMessage && typeof streamingMessage === 'object'
    ? streamingMessage as unknown as { role?: string; content?: unknown; timestamp?: number; id?: string }
    : null;
  const streamText = streamMsg ? extractText(streamMsg) : (typeof streamingMessage === 'string' ? streamingMessage : '');

  const { staticItems, activeTurn } = useChatDisplay({
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
  });

  useEffect(() => {
     
    updateJumpToLatestVisibility();
  }, [
    messages.length,
    sending,
    pendingFinal,
    streamText,
    streamingMessages.length,
    streamingToolResults.length,
    streamingTools.length,
    updateJumpToLatestVisibility,
  ]);

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
  }, [isSearchOpen, contentRef, currentSessionKey, staticItems, activeTurn, showThinking, streamText, streamingTools.length]);

  const searchMatches = useMemo(() => {
    if (!deferredSearchQuery) return [];
    const normalizedQuery = deferredSearchQuery.toLocaleLowerCase();
    return searchableMessages.filter((entry) => entry.text.toLocaleLowerCase().includes(normalizedQuery));
  }, [deferredSearchQuery, searchableMessages]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveSearchIndex(0);
  }, [deferredSearchQuery]);

  useEffect(() => {
    if (searchMatches.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveSearchIndex(0);
      return;
    }
    setActiveSearchIndex((currentIndex) => Math.min(currentIndex, searchMatches.length - 1));
  }, [searchMatches]);

  const activeSearchMatch = searchMatches[activeSearchIndex] ?? null;
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

    const delta = target.getBoundingClientRect().top - container.getBoundingClientRect().top - 28;
    container.scrollBy({ top: delta, behavior });
  }, [contentRef, scrollRef]);

  useEffect(() => {
    if (!activeSearchMatch || !deferredSearchQuery) return;
    scrollToMessageMatch(activeSearchMatch.key, 'smooth');
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

  const scrollToLatest = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      scrollToBottom(behavior);
      setShowJumpToLatest(false);
    },
    [scrollToBottom],
  );

  const { composeSeed: subitemComposeSeed } = useStoTaskSubitemEntry({
    scrollToLatest,
    onSend,
  });

  const effectiveComposerSeed = subitemComposeSeed ?? seedText;

  const previewPanelPercent = useSettingsStore((s) => s.previewSplitPercent ?? 50);
  const setPreviewSplitPercent = useSettingsStore((s) => s.setPreviewSplitPercent);
  const { splitRowRef, previewPanelRef, startResize, adjustPreviewPercent, isResizing } = useSplitPanelResize(
    previewPanelPercent,
    setPreviewSplitPercent,
  );

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

  const currentSession = useMemo(
    () => sessions.find((session) => session.key === currentSessionKey),
    [sessions, currentSessionKey],
  );

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

  const headerLayoutMode =
    !canShowPreviewPanel || previewMode === 'closed'
      ? 'conversation'
      : previewMode === 'expanded'
        ? 'preview-expanded'
        : 'split';

  useContentHeader({
    title: sessionTitle,
    previewTabs: previewHeaderTabs,
    chatActions: conversationHeaderActions,
    previewActions: previewHeaderActions,
    layoutMode: headerLayoutMode,
  });

  const isSplitChatLayout = isPreviewSplit;
  const showPreviewSurface = canShowPreviewPanel && showPreviewPanel;

  const showLoadingPlaceholder = useMemo(
    () => loading && messages.length === 0,
    [loading, messages.length],
  );

  return (
    <>
    <div
      ref={splitRowRef}
      className={cn(
        'relative min-h-0 flex-1 overflow-hidden',
        isSplitChatLayout
          ? stoSplitRowContentsClass
          : isPreviewExpanded
            ? 'flex min-h-0 flex-1 flex-col'
            : 'flex flex-row',
        className,
      )}
    >
      <ChatConversationColumn
        variant="home"
        isSplitLayout={isSplitChatLayout}
        isPreviewExpanded={isPreviewExpanded}
        splitGridChatClass={isSplitChatLayout ? stoSplitGridBodyChatClass : undefined}
      >
      <div className={stoOverlayScrollHostClass}>
      <div
        ref={scrollRef}
        className={isSplitChatLayout ? stoChatScrollPaneSplitClass : stoChatScrollPaneClass}
      >
        <div
          ref={contentRef}
          className={cn(
            stoChatScrollContentClass,
            stoChatColumnContentTrackClass('home', isSplitChatLayout),
          )}
        >
          {showLoadingPlaceholder ? (
            <div className="flex justify-center py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
            </div>
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
                      turnMessages={item.messages}
                      turnToolResults={item.toolResults}
                      precedingUserMessage={item.precedingUserMessage}
                      turnStableKey={item.key}
                      showThinking={showThinking}
                      matchedMessageKeys={matchedMessageKeys}
                      activeMessageKey={activeSearchMatch?.key ?? null}
                      onPreviewFile={openArtifactPreview}
                      onCreateScheduledTask={openWorkflowCronTaskModal}
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
                    showThinking={showThinking}
                    searchMessageKey={searchMessageKey}
                    isSearchMatch={matchedMessageKeys.has(searchMessageKey)}
                    isSearchActive={searchMessageKey === activeSearchMatch?.key}
                    onPreviewFile={openArtifactPreview}
                    onCreateScheduledTask={openWorkflowCronTaskModal}
                  />
                );
              })}
              {activeTurn ? (
                <AssistantTurnMessage
                  key="active-turn"
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
                />
              ) : null}
            </>
          )}
        </div>
      </div>
      <OverlayScrollbar viewportRef={scrollRef} contentRef={contentRef} />
      </div>

      <div className="relative z-10 w-full shrink-0">
        <div className={stoChatColumnContentTrackClass('home', isSplitChatLayout)}>
      {error ? (
        <div
          role="alert"
          className="mb-3.5 shrink-0 overflow-hidden rounded-[10px] border border-[var(--sto-chat-error-border)] bg-[var(--sto-chat-error-bg)]"
        >
          <div className="flex items-start gap-2 p-2">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--sto-chat-error-icon)]"
              aria-hidden
            />
            <p className="max-h-40 min-w-0 flex-1 overflow-y-auto break-words text-[13px] leading-5 text-foreground">
              {error}
            </p>
            <button
              type="button"
              onClick={() => clearError()}
              aria-label={t('common:actions.close')}
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-foreground transition-colors hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              <X className="h-4 w-4" aria-hidden />
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

      <HomeComposer
        seedText={effectiveComposerSeed}
        seedSkillSlug={subitemComposeSeed ? undefined : seedSkillSlug}
        onSend={onSend}
      />
        </div>
      </div>

      {minLoading && !sending ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-white/10 backdrop-blur-[2px] dark:bg-black/10" />
      ) : null}
      </ChatConversationColumn>

    {/* Resize handle — Preview 侧 Body Row overlay；仅 split 渲染 */}
    {/* Preview surface — expanded 时 Conversation 仍挂载；禁止 DOM Fullscreen */}
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
