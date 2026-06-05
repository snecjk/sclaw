/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowDown, Bot, Cpu, Loader2, Orbit, Sparkles, Workflow } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useChatStore, type AttachedFileMeta } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ChatMessage } from './ChatMessage';
import { AssistantTurnMessage } from './AssistantTurnMessage';
import { useChatDisplay } from './use-chat-display';
import { ChatInput, type FileAttachment } from './ChatInput';
import { ChatToolbar } from './ChatToolbar';
import { PendingQueuePanel } from './PendingQueuePanel';
import { ChatPreviewPanel } from './ChatPreviewPanel';
import { extractText, usePreviewableFiles } from './message-utils';
import { useMessageQueueStore, createAutoSendWatcher } from '@/stores/message-queue';
import { invokeApi } from '@/lib/api-client';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useChatScrollFollow } from '@/hooks/use-chat-scroll-follow';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { useMinLoading } from '@/hooks/use-min-loading';

export function Chat() {
  const { t } = useTranslation('chat');
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

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
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abortRun = useChatStore((s) => s.abortRun);
  const clearError = useChatStore((s) => s.clearError);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);

  const cleanupEmptySession = useChatStore((s) => s.cleanupEmptySession);

  // ── Message Queue ──
  const queue = useMessageQueueStore((s) => s.getQueue(currentSessionKey));
  const queueRemove = useCallback((id: string) => useMessageQueueStore.getState().remove(currentSessionKey, id), [currentSessionKey]);
  const queueMoveUp = useCallback((id: string) => useMessageQueueStore.getState().moveUp(currentSessionKey, id), [currentSessionKey]);
  const queueMoveDown = useCallback((id: string) => useMessageQueueStore.getState().moveDown(currentSessionKey, id), [currentSessionKey]);

  const [streamingTimestamp, setStreamingTimestamp] = useState<number>(0);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [showPreviewPanel, setShowPreviewPanel] = useState(false);
  const [activePreviewFilePath, setActivePreviewFilePath] = useState<string | null>(null);
  const [previewPanelWidth, setPreviewPanelWidth] = useState(480);
  const [isResizing, setIsResizing] = useState(false);
  const previewPanelRef = useRef<HTMLDivElement>(null);
  const minLoading = useMinLoading(loading && messages.length > 0);
  const { contentRef, scrollRef, scrollToBottom, stopScroll } = useStickToBottomInstant(currentSessionKey);

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

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

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
    streamMsg,
    streamText,
    streamingTools,
  });

  const streamContentKey = useMemo(
    () =>
      [
        messages.length,
        staticItems.length,
        activeTurn ? 1 : 0,
        streamText.length,
        streamingTools.length,
        pendingFinal ? 1 : 0,
        shouldRenderStreaming ? 1 : 0,
      ].join(':'),
    [
      messages.length,
      staticItems.length,
      activeTurn,
      streamText.length,
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

  const handleSend = useCallback(async (
    text: string,
    attachments?: Parameters<typeof sendMessage>[1],
    targetAgentId?: Parameters<typeof sendMessage>[2],
    dingTalkMentions?: Parameters<typeof sendMessage>[3],
  ) => {
    beginSendScroll();

    // @ 钉钉收件人已结构化选定，禁止 question:split 拆散上下文与收件人元数据
    const skipQuestionSplit = !!(dingTalkMentions && dingTalkMentions.length > 0);

    let parts: Array<{ type: string; context: string }> | null = null;
    if (!skipQuestionSplit) {
      setSplitting(true);
      try {
        const { currentAgentId, currentSessionKey } = useChatStore.getState();
        parts = await invokeApi<Array<{ type: string; context: string }>>('question:split', {
          prompt: text,
          agentId: currentAgentId,
          sessionId: currentSessionKey,
        });
      } catch {
        // Silent fallback — send original text
      } finally {
        setSplitting(false);
      }
    }

    if (parts && parts.length > 1) {
      sendMessage(parts[0].context, attachments, targetAgentId, dingTalkMentions);
      for (let i = 1; i < parts.length; i++) {
        useMessageQueueStore.getState().enqueue(currentSessionKey, parts[i].context, undefined, targetAgentId);
      }
    } else {
      sendMessage(text, attachments, targetAgentId, dingTalkMentions);
    }
  }, [beginSendScroll, sendMessage, currentSessionKey]);

  const handleQueue = useCallback((
    text: string,
    attachments?: FileAttachment[],
    targetAgentId?: string | null,
    dingTalkMentions?: Parameters<typeof sendMessage>[3],
  ) => {
    const { currentSessionKey } = useChatStore.getState();
    useMessageQueueStore.getState().enqueue(currentSessionKey, text, attachments, targetAgentId, dingTalkMentions);
  }, []);

  // ── Resizable panel logic ──
  // Use a full-screen overlay during drag so mouse events are never lost,
  // even when moving quickly outside the resizer or the page container.
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = previewPanelRef.current?.offsetWidth ?? previewPanelWidth;
    let rafId: number | null = null;
    let pendingWidth = startWidth;

    setIsResizing(true);
    document.body.style.userSelect = 'none';

    // Full-screen overlay captures all mouse events during drag
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

    // Safety: if component unmounts during drag, remove overlay
    return () => {
      cleanup();
    };
  }, [previewPanelWidth]);

  // Collect previewable files from messages and streaming message
  const allMessagesForPreview = useMemo(() => {
    const arr = [...messages] as Array<{ _attachedFiles?: AttachedFileMeta[]; role?: string }>;
    if (streamMsg) {
      arr.push(streamMsg as unknown as { _attachedFiles?: AttachedFileMeta[]; role?: string });
    }
    return arr;
  }, [messages, streamMsg]);
  const previewableFiles = usePreviewableFiles(allMessagesForPreview);
  const hasPreviewableFiles = previewableFiles.length > 0;



  // Auto-send watcher: sends queued messages one-by-one when AI finishes responding
  useEffect(() => {
    const unsub = createAutoSendWatcher(() => scrollToLatest('auto'));
    return unsub;
  }, [scrollToLatest]);

  return (
    <div
      className={cn('relative -m-6 flex min-h-0 min-w-0 overflow-x-hidden transition-colors duration-500')}
      style={{ height: 'calc(100vh - 2.5rem)' }}
    >
      {/* Left: Chat area */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,140,0,0.06),_transparent_30%),radial-gradient(circle_at_80%_20%,_rgba(229,230,235,0.35),_transparent_26%)]" />
        <div className="absolute inset-0 neural-grid opacity-20" />
        <div className="absolute left-8 top-10 h-40 w-40 rounded-full bg-cyan-400/10 blur-[90px]" />
        <div className="absolute right-8 top-20 h-48 w-48 rounded-full bg-[rgba(255,111,0,0.06)] blur-[110px]" />
      </div>

      {/* Toolbar */}
      <div className="relative z-10 flex shrink-0 items-center justify-between px-6 py-2">
        <ChatToolbar />
      </div>

      {/* Messages Area */}
      <div
        ref={scrollRef}
        className="relative z-10 flex-1 overflow-y-auto overscroll-y-contain px-6 py-4 [scrollbar-gutter:stable]"
      >
        <div ref={contentRef} className="max-w-5xl mx-auto space-y-4">
          {isEmpty ? (
            <WelcomeScreen />
          ) : (
            <>
              {staticItems.map((item) => {
                const onPreviewFile = (file: AttachedFileMeta) => {
                  if (file.filePath) {
                    setActivePreviewFilePath(file.filePath);
                    setShowPreviewPanel(true);
                  }
                };
                if (item.type === 'assistant-turn') {
                  return (
                    <AssistantTurnMessage
                      key={item.key}
                      turnMessages={item.messages}
                      showThinking={showThinking}
                      onPreviewFile={onPreviewFile}
                    />
                  );
                }
                return (
                  <ChatMessage
                    key={item.key}
                    message={item.message}
                    showThinking={showThinking}
                    onPreviewFile={onPreviewFile}
                  />
                );
              })}

              {activeTurn ? (
                <AssistantTurnMessage
                  key="active-turn"
                  turnMessages={activeTurn.turnMessages}
                  showThinking={showThinking}
                  activeStream={activeTurn.activeStream}
                  onPreviewFile={(file) => {
                    if (file.filePath) {
                      setActivePreviewFilePath(file.filePath);
                      setShowPreviewPanel(true);
                    }
                  }}
                />
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Error bar */}
      {error && (
        <div className="px-6 py-2 bg-destructive/10 border-t border-destructive/20">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
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
          'pointer-events-none shrink-0 overflow-hidden px-6',
          showJumpToLatest ? 'py-0.5' : 'h-0 py-0',
        )}
      >
        <div className="max-w-5xl mx-auto flex justify-center">
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
            className="shrink-0 px-6"
          >
            <div className="max-w-5xl mx-auto flex items-center gap-2 rounded-lg border border-border bg-white/50 px-3 py-2 text-xs text-muted-foreground backdrop-blur-sm dark:bg-white/[0.06]">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span>{t('splitting')}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pending Message Queue */}
      <PendingQueuePanel
        queue={queue}
        onRemove={queueRemove}
        onMoveUp={queueMoveUp}
        onMoveDown={queueMoveDown}
      />

      {/* Input Area */}
      <ChatInput
        onSend={handleSend}
        onStop={abortRun}
        onQueue={handleQueue}
        disabled={!isGatewayRunning}
        sending={sending}
        isEmpty={isEmpty}
      />

      {/* Transparent loading overlay */}
      {minLoading && !sending && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/10 dark:bg-black/10 backdrop-blur-[2px] rounded-xl pointer-events-auto">
          <div className="glass shadow-glass rounded-full p-2.5 border border-glass-border">
            <LoadingSpinner size="md" />
          </div>
        </div>
      )}
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
            // className="shrink-0 overflow-hidden"
            style={{ width: previewPanelWidth }}
            className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden [contain:inline-size]"
          >
            <ChatPreviewPanel
              files={previewableFiles}
              activeFilePath={activePreviewFilePath}
              onSelectFile={setActivePreviewFilePath}
              onClose={() => setShowPreviewPanel(false)}
              className="h-full w-full"
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
