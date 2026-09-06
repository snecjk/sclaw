import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronDown, Loader2, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useChatStore, type RawMessage } from '@/stores/chat';
import { useCurrentChatDisplayMessages } from '@/stores/chat/display-selectors';
import { useCurrentChatRuntimeView } from '@/stores/chat/runtime-selectors';
import { useChatPreviewPanel } from '@/hooks/use-chat-preview-panel';
import {
  EMPTY_WORKFLOW_CHAT_CARD_REFS,
  useWorkflowChatCardsStore,
} from '@/stores/workflow-chat-cards';
import { createAutoSendWatcher } from '@/stores/message-queue';
import { AssistantTurnMessage } from '@/pages/Chat/AssistantTurnMessage';
import {
  collectSearchableChatMessages,
  findChatMessageSearchTarget,
} from '@/pages/Chat/chat-message-search';
import { ChatStaticItemsList, type ChatStaticItemsListHandle } from '@/components/chat/ChatStaticItemsList';
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
import {
  attachMissingWorkflowChatCardAnchors,
  workflowAnchorRepairRevision,
} from '@/lib/workflow-chat-card-registration';

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
  const messages = useCurrentChatDisplayMessages();
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
    activity: runtimeActivity,
    error,
  } = useCurrentChatRuntimeView();
  const showThinking = useChatStore((s) => s.showThinking);
  const toggleThinking = useChatStore((s) => s.toggleThinking);
  const refresh = useChatStore((s) => s.refresh);
  const lastChatEventAt = canonicalLastEventAt;
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

  const anchorRepairRevision = workflowAnchorRepairRevision(messages, workflowCards);
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

  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchableMessages, setSearchableMessages] = useState<Array<{ key: string; text: string }>>([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const { contentRef, scrollRef, scrollToBottom } = useStickToBottomInstant(currentSessionKey);
  const staticItemsListRef = useRef<ChatStaticItemsListHandle>(null);
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
    setShowJumpToLatest(distanceFromBottom > 180);
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
    transcriptPending,
    showThinking,
    workflowCards,
    lastChatEventAt,
    streamMsg,
    streamText,
    streamingMessages,
    streamingToolResults,
    streamingTools,
    turnAnchorAt,
    runtimeActivity,
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
    void useChatStore.getState().loadOlderHistory(currentSessionKey, { drain: true });
  }, [isSearchOpen, currentSessionKey]);

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

  const boundedActiveSearchIndex = searchMatches.length > 0
    ? Math.min(activeSearchIndex, searchMatches.length - 1)
    : 0;
  const activeSearchMatch = searchMatches[boundedActiveSearchIndex] ?? null;
  const matchedMessageKeys = useMemo(
    () => new Set(searchMatches.map((entry) => entry.key)),
    [searchMatches],
  );

  const scrollToMessageMatch = useCallback((searchKey: string, behavior: ScrollBehavior = 'smooth') => {
    if (staticItemsListRef.current?.scrollToSearchKey(searchKey, behavior)) return;

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

  const scrollToLatest = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      scrollToBottom(behavior);
      setShowJumpToLatest(false);
    },
    [scrollToBottom],
  );

  /** 用户主动发送时强制滚到底并重新粘底（即使之前已上滑离开） */
  const handleComposerSend = useCallback(
    (
      text: string,
      attachments?: FileAttachment[],
      targetAgentId?: string | null,
      dingTalkMentions?: DingTalkMention[],
      workflowId?: string | null,
      workflowSource?: string | null,
      workflowName?: string | null,
      skillMeta?: SkillMeta,
      ...rest: unknown[]
    ) => {
      scrollToLatest('auto');
      // ChatInput 会多传 extras；父级 handleHubSend 需要它，props 类型暂未声明
      (onSend as ((...args: unknown[]) => void) | undefined)?.(
        text,
        attachments,
        targetAgentId,
        dingTalkMentions,
        workflowId,
        workflowSource,
        workflowName,
        skillMeta,
        ...rest,
      );
    },
    [onSend, scrollToLatest],
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
    canShowPreviewPanel,
    openArtifactPreview,
    openPreviewPanel,
    closePreviewPanel,
    expandPreview,
    restorePreview,
    showEditWorkflow,
    workflowId: sessionWorkflowId,
    previewTabs,
    activePreviewTabId,
    selectPreviewTab,
    dismissPreviewTab,
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
      showPreviewPanel && previewTabs.length > 0 ? (
        <ChatPreviewHeaderTabs
          tabs={previewTabs}
          activeTabId={activePreviewTabId}
          onSelectTab={selectPreviewTab}
          onDismissTab={dismissPreviewTab}
        />
      ) : null
    ),
    [
      showPreviewPanel,
      previewTabs,
      activePreviewTabId,
      selectPreviewTab,
      dismissPreviewTab,
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
              <ChatStaticItemsList
                ref={staticItemsListRef}
                items={staticItems}
                messages={messages}
                showThinking={showThinking}
                scrollRef={scrollRef}
                variant="home"
                sessionKey={currentSessionKey}
                forceFullRender={isSearchOpen}
                matchedMessageKeys={matchedMessageKeys}
                activeSearchMessageKey={activeSearchMatch?.key ?? null}
                onPreviewFile={openArtifactPreview}
                onCreateScheduledTask={openWorkflowCronTaskModal}
                onOpenWorkflow={openWorkflowList}
                onReachStart={() => {
                  void useChatStore.getState().loadOlderHistory(currentSessionKey);
                }}
              />
              {activeTurn ? (
                <AssistantTurnMessage
                  key="active-turn"
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

      <div className="relative">
        {/* 上浮渐隐带：叠在消息区底部，不占布局高度；全程半透，底部也不完全实色 */}
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-full z-[1] overflow-hidden transition-[height] duration-200',
            showJumpToLatest ? 'h-[72px]' : 'h-0',
            showJumpToLatest &&
              'bg-[linear-gradient(180deg,#fafafa00_0%,#fafafa66_35%,#fafafab0_70%,#fafafae6_100%)] dark:bg-[linear-gradient(180deg,hsl(0_0%_5.1%/0)_0%,hsl(0_0%_5.1%/0.4)_35%,hsl(0_0%_5.1%/0.69)_70%,hsl(0_0%_5.1%/0.9)_100%)]',
          )}
        >
          <div className="flex h-full items-center justify-center">
            <motion.button
              type="button"
              onClick={() => scrollToLatest('smooth')}
              aria-label={t('chat:streaming.jumpToLatest')}
              className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-white/70 text-foreground/80 shadow-[0_1px_4px_rgba(15,23,42,0.08)] backdrop-blur-md transition-colors hover:bg-white/90 hover:text-foreground dark:border-white/12 dark:bg-white/[0.1] dark:text-foreground/90 dark:shadow-[0_1px_4px_rgba(0,0,0,0.35)] dark:hover:bg-white/[0.16]"
              initial={false}
              animate={{
                opacity: showJumpToLatest ? 1 : 0,
                y: showJumpToLatest ? 0 : 6,
                scale: showJumpToLatest ? 1 : 0.96,
                pointerEvents: showJumpToLatest ? 'auto' : 'none',
              }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <ChevronDown className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden />
            </motion.button>
          </div>
        </div>

      <HomeComposer
        seedText={effectiveComposerSeed}
        seedSkillSlug={subitemComposeSeed ? undefined : seedSkillSlug}
        onSend={onSend ? handleComposerSend : undefined}
      />
      </div>
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
          tabs={previewTabs}
          activeTabId={activePreviewTabId}
          sessionKey={currentSessionKey}
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
