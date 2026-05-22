import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowDown, Loader2, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useChatStore, type AttachedFileMeta } from '@/stores/chat';
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
import { FilePreviewViewer } from '@/components/file-preview/FilePreviewViewer';
import { Sheet, SheetContent } from '@/components/ui/sheet';

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

  const [previewFile, setPreviewFile] = useState<AttachedFileMeta | null>(null);

  const handlePreviewFile = useCallback((file: AttachedFileMeta) => {
    setPreviewFile(file);
  }, []);

  const showLoadingPlaceholder = useMemo(
    () => loading && messages.length === 0,
    [loading, messages.length],
  );

  return (
    <div className={cn('relative flex min-h-0 flex-1 flex-col', className)}>
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

      {/* File Preview Sheet */}
      <Sheet open={!!previewFile} onOpenChange={(open) => { if (!open) setPreviewFile(null); }}>
        <SheetContent side="right" className="w-[600px] sm:max-w-[600px] p-0 flex flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-4 py-3">
            <span className="text-sm font-medium truncate">{previewFile?.fileName}</span>
            <button
              type="button"
              onClick={() => setPreviewFile(null)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {previewFile && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-preview-viewer>
              <FilePreviewViewer
                filePath={previewFile.filePath!}
                fileName={previewFile.fileName}
                mimeType={previewFile.mimeType}
                className="h-full w-full"
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
