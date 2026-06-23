import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowDown, Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useChatStore, type RawMessage } from '@/stores/chat';
import { useChatPreviewPanel } from '@/hooks/use-chat-preview-panel';
import { useWorkflowCompletion } from '@/hooks/use-workflow-completion';
import { useAgentsStore } from '@/stores/agents';
import { createAutoSendWatcher } from '@/stores/message-queue';
import { ChatMessage } from '@/pages/Chat/ChatMessage';
import { AssistantTurnMessage } from '@/pages/Chat/AssistantTurnMessage';
import { useChatDisplay } from '@/pages/Chat/use-chat-display';
import { extractText } from '@/pages/Chat/message-utils';
import { ChatContentHeaderActions } from '@/pages/Chat/ChatSearchBar';
import { ChatPreviewHeaderTabs } from '@/pages/Chat/ChatPreviewHeaderTabs';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { useMinLoading } from '@/hooks/use-min-loading';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { ChatConversationColumn } from '@/components/chat/chat-conversation-column';
import {
  clampPreviewPanelPercent,
  STO_PREVIEW_SPLIT_MAX,
  STO_PREVIEW_SPLIT_MIN,
  stoSplitPreviewPaneClass,
  stoSplitResizerActiveClass,
  stoSplitResizerClass,
  stoSplitRowInsetsClass,
} from '@/lib/surfaces';
import { ChatPreviewPanel } from '@/pages/Chat/ChatPreviewPanel';
import { HomeComposer } from '@/pages/Home/HomeComposer';
import type { FileAttachment } from '@/pages/Chat/ChatInput';
import type { DingTalkMention } from '@/types/dingtalk-mention';
import { useContentHeader } from '@/components/layout/content-header-context';
import { resolveSessionLabel } from '@/lib/session-label';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';

/**
 * Main-agent conversation thread on the home route (replaces the old `/chat` welcome + messages UI).
 * 三栏预览时输入框与消息同属左侧对话列（与 Chat / 任务子项一致）。
 */
export interface HomeMainConversationProps {
  className?: string;
  /** 一次性填入输入框的种子文案 */
  seedText?: string;
  onSend?: (
    text: string,
    attachments?: FileAttachment[],
    targetAgentId?: string | null,
    dingTalkMentions?: DingTalkMention[],
    workflowId?: string | null,
  ) => void;
}

export function HomeMainConversation({ className, seedText, onSend }: HomeMainConversationProps) {
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
  const streamingTools = useChatStore((s) => s.streamingTools);
  const pendingFinal = useChatStore((s) => s.pendingFinal);
  const clearError = useChatStore((s) => s.clearError);
  const switchSession = useChatStore((s) => s.switchSession);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);

  useWorkflowCompletion(currentSessionKey);

  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchableMessages, setSearchableMessages] = useState<Array<{ id: string; text: string }>>([]);
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

    // eslint-disable-next-line react-hooks/set-state-in-effect
    updateJumpToLatestVisibility();
    scrollElement.addEventListener('scroll', updateJumpToLatestVisibility, { passive: true });
    window.addEventListener('resize', updateJumpToLatestVisibility);

    return () => {
      scrollElement.removeEventListener('scroll', updateJumpToLatestVisibility);
      window.removeEventListener('resize', updateJumpToLatestVisibility);
    };
  }, [currentSessionKey, scrollRef, updateJumpToLatestVisibility]);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

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
    streamMsg,
    streamText,
    streamingTools,
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    updateJumpToLatestVisibility();
  }, [messages.length, sending, pendingFinal, streamText, streamingTools.length, updateJumpToLatestVisibility]);

  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
  }, [contentRef, currentSessionKey, staticItems, activeTurn, showThinking, streamText, streamingTools.length]);

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

    const delta = target.getBoundingClientRect().top - container.getBoundingClientRect().top - 28;
    container.scrollBy({ top: delta, behavior });
  }, [contentRef, scrollRef]);

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

  const scrollToLatest = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      scrollToBottom(behavior);
      setShowJumpToLatest(false);
    },
    [scrollToBottom],
  );

  const [isResizing, setIsResizing] = useState(false);
  const previewPanelRef = useRef<HTMLDivElement>(null);
  const previewPanelPercent = useSettingsStore((s) => s.previewSplitPercent ?? 50);
  const setPreviewSplitPercent = useSettingsStore((s) => s.setPreviewSplitPercent);

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
      showPreviewPanel && (previewableFiles.length > 0 || showEditWorkflow) ? (
        <ChatPreviewHeaderTabs
          files={previewableFiles}
          activeFilePath={activePreviewFilePath}
          onSelectFile={setActivePreviewFilePath}
          onDismissFile={dismissPreviewFile}
          showEditWorkflow={showEditWorkflow}
          workflowId={sessionWorkflowId}
        />
      ) : null
    ),
    [
      showPreviewPanel,
      previewableFiles,
      activePreviewFilePath,
      setActivePreviewFilePath,
      dismissPreviewFile,
      showEditWorkflow,
      sessionWorkflowId,
    ],
  );

  const handleCloseSession = useCallback(() => {
    closePreviewPanel();
    switchSession(DEFAULT_SESSION_KEY);
  }, [closePreviewPanel, switchSession]);

  useContentHeader({
    title: sessionTitle,
    previewTabs: previewHeaderTabs,
    actions: headerActions,
    isSplitLayout: canShowPreviewPanel && showPreviewPanel,
    onCloseSession: handleCloseSession,
  });

  const isSplitChatLayout = canShowPreviewPanel && showPreviewPanel;

  // ── Resizable panel logic（与 Chat / 任务子项一致）──
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

  const showLoadingPlaceholder = useMemo(
    () => loading && messages.length === 0,
    [loading, messages.length],
  );

  return (
    <div className={cn(
      'relative flex min-h-0 flex-1 flex-row overflow-hidden',
      isSplitChatLayout && stoSplitRowInsetsClass,
      className,
    )}>
      <ChatConversationColumn variant="home" isSplitLayout={isSplitChatLayout}>
      <div
        ref={scrollRef}
        className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-y-contain py-4 [scrollbar-gutter:stable]"
      >
        <div ref={contentRef} className="space-y-4">
          {showLoadingPlaceholder ? (
            <div className="flex justify-center py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
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
                      matchedMessageIds={matchedMessageIds}
                      activeMessageId={activeSearchMatch?.id ?? null}
                      onPreviewFile={openArtifactPreview}
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
              onClick={() => clearError()}
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
        <HomeComposer
          seedText={seedText}
          onSend={onSend}
        />
      </div>

      {minLoading && !sending ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-white/10 backdrop-blur-[2px] dark:bg-black/10" />
      ) : null}
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
          layout={false}
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
            className="h-full w-full"
          />
        </motion.div>
      )}
    </AnimatePresence>
  </div>
  );
}
