import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowDown, Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useChatStore, type AttachedFileMeta, type RawMessage } from '@/stores/chat';
import { useSessionWorkflowPreview } from '@/hooks/use-session-workflow-preview';
import { useWorkflowCompletion } from '@/hooks/use-workflow-completion';
import { useAgentsStore } from '@/stores/agents';
import { createAutoSendWatcher } from '@/stores/message-queue';
import { ChatMessage } from '@/pages/Chat/ChatMessage';
import { AssistantTurnMessage } from '@/pages/Chat/AssistantTurnMessage';
import { useChatDisplay } from '@/pages/Chat/use-chat-display';
import { extractText } from '@/pages/Chat/message-utils';
import { ChatToolbar } from '@/pages/Chat/ChatToolbar';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { useMinLoading } from '@/hooks/use-min-loading';
import { cn } from '@/lib/utils';
import { ChatPreviewPanel } from '@/pages/Chat/ChatPreviewPanel';
import { usePreviewableFiles } from '@/pages/Chat/message-utils';

/**
 * Main-agent conversation thread on the home route (replaces the old `/chat` welcome + messages UI).
 */
export function HomeMainConversation({ className }: { className?: string }) {
  const { t } = useTranslation(['chat', 'common']);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const messages = useChatStore((s) => s.messages);
  const loading = useChatStore((s) => s.loading);
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const showThinking = useChatStore((s) => s.showThinking);
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const streamingTools = useChatStore((s) => s.streamingTools);
  const pendingFinal = useChatStore((s) => s.pendingFinal);
  const clearError = useChatStore((s) => s.clearError);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);

  useWorkflowCompletion(currentSessionKey);

  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const { contentRef, scrollRef, scrollToBottom } = useStickToBottomInstant(currentSessionKey);
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
    updateJumpToLatestVisibility();
  }, [messages.length, sending, pendingFinal, streamText, streamingTools.length, updateJumpToLatestVisibility]);

  const scrollToLatest = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      scrollToBottom(behavior);
      setShowJumpToLatest(false);
    },
    [scrollToBottom],
  );

  const [activePreviewFilePath, setActivePreviewFilePath] = useState<string | null>(null);
  const [showPreviewPanel, setShowPreviewPanel] = useState(false);
  const [previewPanelWidth, setPreviewPanelWidth] = useState(480);
  const [isResizing, setIsResizing] = useState(false);
  const previewPanelRef = useRef<HTMLDivElement>(null);

  const allMessagesForPreview = useMemo(() => {
    const arr = [...messages] as Array<{ _attachedFiles?: AttachedFileMeta[]; role?: string }>;
    if (streamMsg) {
      arr.push(streamMsg as unknown as { _attachedFiles?: AttachedFileMeta[]; role?: string });
    }
    return arr;
  }, [messages, streamMsg]);
  const previewableFiles = usePreviewableFiles(allMessagesForPreview);
  const hasPreviewableFiles = previewableFiles.length > 0;

  const {
    workflowId: sessionWorkflowId,
    showWorkflowTab,
    detail: workflowDetail,
    loading: workflowLoading,
    error: workflowError,
  } = useSessionWorkflowPreview(allMessagesForPreview as RawMessage[]);

  const handlePreviewFile = useCallback((file: AttachedFileMeta) => {
    if (file.filePath) {
      setActivePreviewFilePath(file.filePath);
      setShowPreviewPanel(true);
    }
  }, []);

  // ── Resizable panel logic ──
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = previewPanelRef.current?.offsetWidth ?? previewPanelWidth;
    let rafId: number | null = null;
    let pendingWidth = startWidth;

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
      pendingWidth = Math.max(320, Math.min(900, startWidth + delta));
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
      setPreviewPanelWidth(pendingWidth);
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
  }, [previewPanelWidth]);

  const showLoadingPlaceholder = useMemo(
    () => loading && messages.length === 0,
    [loading, messages.length],
  );

  return (
    <div className={cn('-mt-4 relative flex min-h-0 flex-1', className)}>
      {/* Left: Chat area */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="relative z-10 flex shrink-0 items-center justify-between px-4 py-2 sm:px-6">
          <ChatToolbar />
        </div>
      <div
        ref={scrollRef}
        className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-4 sm:px-6 [scrollbar-gutter:stable]"
      >
        <div ref={contentRef} className="mx-auto max-w-5xl space-y-4">
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
        <div className="shrink-0 border-t border-destructive/20 bg-destructive/10 px-4 py-2 sm:px-6">
          <div className="mx-auto flex max-w-5xl items-center justify-between">
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
          'pointer-events-none shrink-0 overflow-hidden px-4 sm:px-6',
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

      {minLoading && !sending ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-white/10 backdrop-blur-[2px] dark:bg-black/10" />
      ) : null}
      </div>

    {/* Resizer */}
    {hasPreviewableFiles && showPreviewPanel && (
      <div
        onMouseDown={startResize}
        className={cn(
          'relative z-20 flex h-full shrink-0 cursor-col-resize items-center justify-center transition-colors',
          isResizing ? 'bg-primary/50 w-[5px]' : 'bg-border/50 w-[5px] hover:bg-primary/40',
        )}
        style={{ cursor: isResizing ? 'col-resize' : undefined }}
      >
        <div className={cn('h-8 w-[2px] rounded-full', isResizing ? 'bg-primary' : 'bg-muted-foreground/30')} />
      </div>
    )}

    {/* Right: Preview Panel */}
    <AnimatePresence>
      {hasPreviewableFiles && showPreviewPanel && (
        <motion.div
          ref={previewPanelRef}
          layout={false}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 40 }}
          transition={{ duration: 0.25, ease: 'easeInOut' }}
          style={{ width: previewPanelWidth }}
          className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-l border-border/40 [contain:inline-size]"
        >
          <ChatPreviewPanel
            files={previewableFiles}
            activeFilePath={activePreviewFilePath}
            onSelectFile={setActivePreviewFilePath}
            onClose={() => setShowPreviewPanel(false)}
            className="h-full w-full"
            showWorkflowTab={showWorkflowTab}
            workflowId={sessionWorkflowId}
            workflowDetail={workflowDetail}
            workflowLoading={workflowLoading}
            workflowError={workflowError}
          />
        </motion.div>
      )}
    </AnimatePresence>

    {/* Floating toggle button when panel is hidden but files exist */}
    {hasPreviewableFiles && !showPreviewPanel && (
      <button
        onClick={() => setShowPreviewPanel(true)}
        className="absolute right-4 top-4 z-20 inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-white/60 px-3 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-white/80 dark:bg-white/[0.08] dark:hover:bg-white/[0.14]"
      >
        <span>预览产物</span>
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] text-primary">
          {previewableFiles.length}
        </span>
      </button>
    )}
  </div>
  );
}
