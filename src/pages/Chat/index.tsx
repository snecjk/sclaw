/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ArrowDown, Loader2, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { useChatStore, type RawMessage } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ParticleConstellation } from '@/components/common/ParticleConstellation';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatToolbar } from './ChatToolbar';
import { extractImages, extractText, extractThinking, extractToolUse } from './message-utils';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
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
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abortRun = useChatStore((s) => s.abortRun);
  const clearError = useChatStore((s) => s.clearError);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);

  const cleanupEmptySession = useChatStore((s) => s.cleanupEmptySession);

  const [streamingTimestamp, setStreamingTimestamp] = useState<number>(0);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const minLoading = useMinLoading(loading && messages.length > 0);
  const { contentRef, scrollRef } = useStickToBottomInstant(currentSessionKey);

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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStreamingTimestamp(Date.now() / 1000);
    } else if (!sending && streamingTimestamp !== 0) {
      setStreamingTimestamp(0);
    }
  }, [sending, streamingTimestamp]);

  // Gateway not running block has been completely removed so the UI always renders.

  const streamMsg = streamingMessage && typeof streamingMessage === 'object'
    ? streamingMessage as unknown as { role?: string; content?: unknown; timestamp?: number }
    : null;
  const streamText = streamMsg ? extractText(streamMsg) : (typeof streamingMessage === 'string' ? streamingMessage : '');
  const hasStreamText = streamText.trim().length > 0;
  const streamThinking = streamMsg ? extractThinking(streamMsg) : null;
  const hasStreamThinking = showThinking && !!streamThinking && streamThinking.trim().length > 0;
  const streamTools = streamMsg ? extractToolUse(streamMsg) : [];
  const hasStreamTools = streamTools.length > 0;
  const streamImages = streamMsg ? extractImages(streamMsg) : [];
  const hasStreamImages = streamImages.length > 0;
  const hasStreamToolStatus = streamingTools.length > 0;
  const shouldRenderStreaming = sending && (hasStreamText || hasStreamThinking || hasStreamTools || hasStreamImages || hasStreamToolStatus);
  const hasAnyStreamContent = hasStreamText || hasStreamThinking || hasStreamTools || hasStreamImages || hasStreamToolStatus;

  const isEmpty = messages.length === 0 && !sending;

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    scrollElement.scrollTo({
      top: scrollElement.scrollHeight,
      behavior,
    });
  }, [scrollRef]);

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

  const handleSend = useCallback((
    text: string,
    attachments?: Parameters<typeof sendMessage>[1],
    targetAgentId?: Parameters<typeof sendMessage>[2],
  ) => {
    scrollToLatest('auto');
    sendMessage(text, attachments, targetAgentId);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToLatest('smooth');
      });
    });
  }, [scrollToLatest, sendMessage]);

  return (
    <div className={cn("relative flex flex-col -m-6 transition-colors duration-500")} style={{ height: 'calc(100vh - 2.5rem)' }}>
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-end px-4 py-2">
        <ChatToolbar />
      </div>

      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        <div ref={contentRef} className="max-w-4xl mx-auto space-y-4">
          {isEmpty ? (
            <WelcomeScreen />
          ) : (
            <>
              {messages.map((msg, idx) => (
                <ChatMessage
                  key={msg.id || `msg-${idx}`}
                  message={msg}
                  showThinking={showThinking}
                />
              ))}

              {/* Streaming message */}
              {shouldRenderStreaming && (
                <ChatMessage
                  message={(streamMsg
                    ? {
                        ...(streamMsg as Record<string, unknown>),
                        role: (typeof streamMsg.role === 'string' ? streamMsg.role : 'assistant') as RawMessage['role'],
                        content: streamMsg.content ?? streamText,
                        timestamp: streamMsg.timestamp ?? streamingTimestamp,
                      }
                    : {
                        role: 'assistant',
                        content: streamText,
                        timestamp: streamingTimestamp,
                      }) as RawMessage}
                  showThinking={showThinking}
                  isStreaming
                  streamingTools={streamingTools}
                />
              )}

              {/* Activity indicator: waiting for next AI turn after tool execution */}
              {sending && pendingFinal && !shouldRenderStreaming && (
                <ActivityIndicator phase="tool_processing" />
              )}

              {/* Typing indicator when sending but no stream content yet */}
              {sending && !pendingFinal && !hasAnyStreamContent && (
                <TypingIndicator />
              )}
            </>
          )}
        </div>
      </div>

      {/* Error bar */}
      {error && (
        <div className="px-4 py-2 bg-destructive/10 border-t border-destructive/20">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
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

      {/* Jump to latest */}
      <div className="pointer-events-none shrink-0 px-4">
        <div className="mx-auto flex max-w-4xl justify-center">
          <motion.button
            type="button"
            onClick={() => scrollToLatest('smooth')}
            className="pointer-events-auto mb-2 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-background/78 px-3 py-2 text-xs font-medium text-foreground shadow-[0_10px_26px_rgba(15,23,42,0.12)] backdrop-blur-md transition-colors hover:bg-background/92"
            initial={false}
            animate={{
              opacity: showJumpToLatest ? 1 : 0,
              y: showJumpToLatest ? 0 : 8,
              scale: showJumpToLatest ? 1 : 0.96,
              pointerEvents: showJumpToLatest ? 'auto' : 'none',
            }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <ArrowDown className="h-3.5 w-3.5" />
            <span>{t('streaming.jumpToLatest')}</span>
          </motion.button>
        </div>
      </div>

      {/* Input Area */}
      <ChatInput
        onSend={handleSend}
        onStop={abortRun}
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
    { key: 'askQuestions', label: t('welcome.askQuestions') },
    { key: 'creativeTasks', label: t('welcome.creativeTasks') },
    { key: 'brainstorming', label: t('welcome.brainstorming') },
  ];

  return (
    <div className="relative flex flex-col items-center justify-center text-center h-[60vh] overflow-hidden">
      <ParticleConstellation className="z-0" />

      <div className="relative z-10 flex flex-col items-center justify-center">
        <motion.h1
          className="text-4xl md:text-5xl font-serif text-foreground/80 mb-8 font-normal tracking-tight"
          style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        >
          {t('welcome.subtitle')}
        </motion.h1>

        <motion.div
          className="flex flex-wrap items-center justify-center gap-2.5 max-w-lg w-full"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.1, delayChildren: 0.4 } },
          }}
        >
          {quickActions.map(({ key, label }) => (
            <motion.button
              key={key}
              className="px-4 py-1.5 rounded-full border border-glass-border text-[13px] font-medium text-foreground/70 hover:bg-white/20 dark:hover:bg-white/10 transition-colors glass-subtle"
              variants={buttonVariants}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            >
              {label}
            </motion.button>
          ))}
        </motion.div>
      </div>
    </div>
  );
}

// ── Typing Indicator ────────────────────────────────────────────

function TypingIndicator() {
  const { t } = useTranslation('chat');

  return (
    <AssistantActivityCard
      badge={t('streaming.thinkingBadge')}
      title={t('streaming.thinkingTitle')}
      description={t('streaming.thinkingDescription')}
      tone="thinking"
    />
  );
}

// ── Activity Indicator (shown between tool cycles) ─────────────

function ActivityIndicator({ phase }: { phase: 'tool_processing' }) {
  void phase;
  const { t } = useTranslation('chat');

  return (
    <AssistantActivityCard
      badge={t('streaming.processingBadge')}
      title={t('streaming.processingTitle')}
      description={t('streaming.processingDescription')}
      tone="processing"
    />
  );
}

function AssistantActivityCard({
  badge,
  title,
  description,
  tone,
}: {
  badge: string;
  title: string;
  description: string;
  tone: 'thinking' | 'processing';
}) {
  const isProcessing = tone === 'processing';

  return (
    <div className="flex gap-3">
      <div className="relative mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/15 bg-white/40 text-foreground shadow-sm dark:bg-white/[0.10]">
        <motion.span
          className="absolute inset-0 rounded-full border border-primary/25"
          animate={{ scale: [1, 1.18], opacity: [0.3, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
        />
        {isProcessing ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : (
          <Sparkles className="h-4 w-4 text-primary" />
        )}
      </div>

      <div
        className={cn(
          'relative min-w-[280px] overflow-hidden rounded-2xl border px-4 py-3.5 text-foreground shadow-[0_10px_30px_rgba(15,23,42,0.08)]',
          'bg-white/40 dark:bg-white/[0.10]',
          isProcessing ? 'border-primary/15' : 'border-primary/20',
        )}
      >
        <motion.div
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-primary/10 to-transparent"
          initial={{ x: '-120%' }}
          animate={{ x: '120%' }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />

        <div className="relative flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.22em] text-primary/80">
          <motion.span
            className="h-2.5 w-8 rounded-full bg-primary/25"
            animate={{
              opacity: [0.45, 1, 0.55],
              scaleX: [0.94, 1.04, 0.97],
            }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          />
          <span>{badge}</span>
        </div>

        <div className="relative mt-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            {isProcessing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-primary" />
            )}
            <span>{title}</span>
          </div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {description}
          </p>

          <div className="mt-3 flex gap-2">
            {[72, 56, 44].map((width, index) => (
              <motion.span
                key={`${tone}-${width}`}
                className="h-1.5 rounded-full bg-primary/20"
                style={{ width }}
                animate={{ opacity: [0.3, 0.85, 0.35] }}
                transition={{
                  duration: 1.8,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  delay: index * 0.16,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Chat;
