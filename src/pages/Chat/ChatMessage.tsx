/**
 * Chat Message Component
 * Renders user / assistant / system / toolresult messages
 * with markdown, thinking sections, images, and tool cards.
 */
import { useState, useCallback, useEffect, useMemo, memo } from 'react';
import { Sparkles, Copy, Check, Pencil, ChevronDown, ChevronRight, Wrench, FileText, Film, Music, FileArchive, File, X, FolderOpen, ZoomIn, Loader2, CheckCircle2, AlertCircle, Table2 } from 'lucide-react';
import { motion } from 'framer-motion';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { assistantChatCardBg, assistantChatCardBgStreaming } from '@/lib/surfaces';
import { invokeIpc } from '@/lib/api-client';
import type { RawMessage, AttachedFileMeta } from '@/stores/chat';
import { useChatStore } from '@/stores/chat';
import { extractText, extractPlainTextFromContent, extractImages, extractToolUse, extractThinkingTimeline, formatTimestamp, extractPreviewableRefs, isPreviewableFile, PREVIEWABLE_FILE_EXTS, extractWorkflowCard, useLocalPathExistence, resolvePreviewCandidate, unwrapPreviewablePathMarkdown } from './message-utils';
import {
  ensureWorkflowParameterFormHandler,
  ensureWorkflowParameterFormInjected,
  isLastAssistantAfterUserTurn,
  resolveParameterFormForAssistantMessage,
} from '@/stores/chat/parameter-form-recovery';
import { WorkflowCard } from '@/components/workflow/WorkflowCard';
import { RUN_ID_IN_TEXT } from '@/lib/workflow-card-injection';
import { getExecutionByRunId } from '@/stores/workflow-memory';
import {
  artifactToPreviewFile,
  inferMimeTypeFromUrl,
  isHttpUrl,
  isPreviewableRemoteUrl,
  openExternalUrl,
  previewHttpUrlLabel,
  resolvePreviewLinkTarget,
  toMarkdownPreviewPath,
} from '@/lib/preview-url';
import { dedupeAttachedFiles, mergePreviewFileLists, normalizePreviewFileKey, previewFileRefsMatch } from '@/lib/preview-file-path';
import { safeDecodeURIComponent } from '@/lib/safe-decode-uri';
import { isFilePreviewDebugEnabled, logFilePreview } from '@/lib/file-preview-debug';
import { ParameterFormCard } from '@/components/parameter-form/ParameterFormCard';
import { submitParameterForm } from '@/components/parameter-form/form-handlers';
import { highlightAtMentionsInChildren } from '@/lib/at-mention-highlight';
import { renderUserMessageMentionNodes } from '@/components/dingtalk/DingTalkMentionTag';
import { ThinkingProcessPanel } from './ThinkingProcessPanel';

const CHAT_EDIT_DRAFT_EVENT = 'stoclaw:chat-edit-draft';

interface ChatMessageProps {
  message: RawMessage;
  showThinking: boolean;
  isSearchMatch?: boolean;
  isSearchActive?: boolean;
  isStreaming?: boolean;
  streamingTools?: Array<{
    id?: string;
    toolCallId?: string;
    name: string;
    status: 'running' | 'completed' | 'error';
    durationMs?: number;
    summary?: string;
  }>;
  onPreviewFile?: (file: AttachedFileMeta) => void;
  onViewWorkflow?: (workflowId: string) => void;
  onCreateScheduledTask?: (workflowId: string) => void;
  onEditMessage?: (text: string) => void;
  /** Used when rendered inside AssistantTurnMessage */
  hideAvatar?: boolean;
  hideThinkingPanel?: boolean;
}

interface ExtractedImage { url?: string; data?: string; mimeType: string; }

/** Resolve an ExtractedImage to a displayable src string, or null if not possible. */
function imageSrc(img: ExtractedImage): string | null {
  if (img.url) return img.url;
  if (img.data) return `data:${img.mimeType};base64,${img.data}`;
  return null;
}

export const ChatMessage = memo(function ChatMessage({
  message,
  showThinking,
  isSearchMatch = false,
  isSearchActive = false,
  isStreaming = false,
  streamingTools = [],
  onPreviewFile,
  onViewWorkflow,
  onCreateScheduledTask,
  onEditMessage,
  hideAvatar = false,
  hideThinkingPanel = false,
}: ChatMessageProps) {
  const { t } = useTranslation('chat');
  const isUser = message.role === 'user';
  const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
  const isSystem = role === 'system';
  const isToolResult = role === 'toolresult' || role === 'tool_result';
  const text = extractText(message);
  const hasText = text.trim().length > 0;
  const [systemExpanded, setSystemExpanded] = useState(false);
  const images = extractImages(message);
  const tools = extractToolUse(message);
  const thinkingTimeline = showThinking ? extractThinkingTimeline(message) : [];
  const showThinkingPanel =
    !hideThinkingPanel &&
    showThinking &&
    (thinkingTimeline.length > 0 || (isStreaming && streamingTools.length > 0));
  const visibleTools = showThinking ? [] : tools;

  const attachedFiles = useMemo(
    () => dedupeAttachedFiles(message._attachedFiles || []),
    [message._attachedFiles],
  );
  const [lightboxImg, setLightboxImg] = useState<{ src: string; fileName: string; filePath?: string; base64?: string; mimeType?: string } | null>(null);
  const pendingWorkflow = useChatStore((s) => s.pendingWorkflow);
  const sessionKey = useChatStore((s) => s.currentSessionKey);
  const sessionMessages = useChatStore((s) => s.messages);
  const workflowCardStates = useChatStore((s) => s.workflowCardStates);
  const workflowCard = useMemo(() => {
    if (isUser) return null;
    const fromBlock = extractWorkflowCard(message);
    if (fromBlock) return fromBlock;
    const runIds = [...text.matchAll(RUN_ID_IN_TEXT)].map((m) => m[1]).filter(Boolean);
    for (let i = runIds.length - 1; i >= 0; i -= 1) {
      const runId = runIds[i]!;
      if (!workflowCardStates[runId]) continue;
      const exec = getExecutionByRunId(runId, sessionKey);
      return { runId, templateName: exec?.templateName ?? '工作流' };
    }
    return null;
  }, [isUser, message, text, workflowCardStates, sessionKey]);
  const parameterForm = useMemo(() => {
    if (isUser) return null;
    return resolveParameterFormForAssistantMessage(message, {
      sessionMessages,
      sessionKey,
      pendingWorkflow,
      getMessageText: extractPlainTextFromContent,
    });
  }, [isUser, message, pendingWorkflow, sessionMessages, sessionKey]);

  useEffect(() => {
    if (!parameterForm || parameterForm.formContext.source !== 'workflow') return;
    ensureWorkflowParameterFormHandler(
      parameterForm.formId,
      parameterForm.formContext.sourceId,
      parameterForm.formContext.schemaHash ?? '',
      useChatStore.getState,
    );
  }, [parameterForm]);

  useEffect(() => {
    if (isUser || !pendingWorkflow?.schema) return;
    if (!isLastAssistantAfterUserTurn(message, sessionMessages)) return;
    ensureWorkflowParameterFormInjected(extractPlainTextFromContent);
  }, [isUser, pendingWorkflow, message, sessionMessages]);

  // Extract previewable refs from message text, then verify non-http paths:
  // local files must exist on disk; cloud-runtime paths resolve to artifact OSS
  // URLs or are dropped (no broken file cards).
  const workflowCardStatesForRefs = workflowCardStates;
  const candidateRefs = useMemo(
    () =>
      extractPreviewableRefs(text)
        .filter((ref) => !attachedFiles.some((f) => previewFileRefsMatch(f, ref)))
        .filter((ref) => isPreviewableFile(ref)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, message._attachedFiles],
  );
  const candidateLocalPaths = useMemo(
    () => candidateRefs.filter((ref) => !isHttpUrl(ref.filePath)).map((ref) => ref.filePath),
    [candidateRefs],
  );
  const refExistence = useLocalPathExistence(candidateLocalPaths);
  const workflowArtifactUrls = useMemo(() => {
    const urls = new Set<string>();
    for (const state of Object.values(workflowCardStatesForRefs)) {
      for (const artifact of state?.result?.artifacts ?? []) {
        if (artifact.url?.startsWith('http')) urls.add(artifact.url);
      }
    }
    return urls;
  }, [workflowCardStatesForRefs]);

  const extractedRefs = useMemo(() => {
    const seen = new Set<string>();
    const result: typeof candidateRefs = [];
    for (const ref of candidateRefs) {
      const resolved = resolvePreviewCandidate(
        { ...ref, fileSize: 0, preview: null },
        refExistence[ref.filePath],
        workflowCardStatesForRefs,
      );
      if (!resolved) continue;
      const key = normalizePreviewFileKey(resolved.filePath, resolved.fileName);
      if (seen.has(key)) continue;
      if (workflowArtifactUrls.has(resolved.filePath)) continue;
      seen.add(key);
      result.push({ filePath: resolved.filePath, fileName: resolved.fileName, mimeType: resolved.mimeType });
    }
    return result;
  }, [candidateRefs, refExistence, workflowCardStatesForRefs, workflowArtifactUrls]);

  const previewFiles = useMemo(
    () => mergePreviewFileLists(
      attachedFiles,
      extractedRefs.map((ref) => ({ ...ref, fileSize: 0, preview: null })),
    ),
    [attachedFiles, extractedRefs],
  );

  useEffect(() => {
    if (!isFilePreviewDebugEnabled() || isUser || !hasText) return;
    logFilePreview('message-refs', {
      messageId: message.id,
      isStreaming,
      hasOnPreviewFile: !!onPreviewFile,
      candidateRefs,
      refExistence,
      extractedRefs,
      attachedFiles: attachedFiles.map((f) => ({
        filePath: f.filePath,
        fileName: f.fileName,
        mimeType: f.mimeType,
      })),
    });
  }, [
    isUser,
    hasText,
    isStreaming,
    onPreviewFile,
    message.id,
    candidateRefs,
    refExistence,
    extractedRefs,
    attachedFiles,
  ]);

  // Previewable file cards (merged from _attachedFiles + text-extracted refs, deduped once)
  const hasRenderableFiles = previewFiles.length > 0;

  // Never render tool result messages in chat UI
  if (isToolResult) return null;

  const hasStreamingToolStatus = isStreaming && streamingTools.length > 0;
  if (!hasText && !showThinkingPanel && images.length === 0 && visibleTools.length === 0 && !hasRenderableFiles && !hasStreamingToolStatus && !parameterForm && !workflowCard) return null;
  const showRenderDebugPanel = !isUser && isFilePreviewDebugEnabled();
  const debugMarkdownSource = useMemo(
    () => (onPreviewFile ? preprocessTextForPreviewLinks(text) : text),
    [text, onPreviewFile],
  );
  const debugLinks = useMemo(() => {
    if (!showRenderDebugPanel) return [];
    const refs = new Set<string>();
    const regex = /\[([^\]]*)\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(debugMarkdownSource)) !== null) {
      const label = (match[1] || '').trim();
      const href = (match[2] || '').trim();
      if (!href) continue;
      refs.add(`${label || '(empty label)'} -> ${href}`);
    }
    return Array.from(refs);
  }, [debugMarkdownSource, showRenderDebugPanel]);
  const copyDebugSnapshot = useCallback(async () => {
    const snapshot = [
      '[StoClaw Render Debug Snapshot]',
      '',
      '[Raw text]',
      text || '(empty)',
      '',
      '[Rendered markdown source]',
      debugMarkdownSource || '(empty)',
      '',
      '[Detected markdown links]',
      debugLinks.length > 0 ? debugLinks.join('\n') : '(none)',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(snapshot);
      toast.success('已复制渲染调试快照');
    } catch {
      toast.error('复制失败，请重试');
    }
  }, [debugLinks, debugMarkdownSource, text]);

  if (isSystem) {
    const compactText = text.replace(/\s+/g, ' ').trim();
    const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || compactText;
    const summary = firstLine.length > 88 ? `${firstLine.slice(0, 88)}…` : firstLine;
    const showToggle = compactText.length > summary.length || text.includes('\n');
    return (
      <div
        data-chat-message-role="system"
        data-chat-message-id={message.id ?? undefined}
        className={cn(
          'mx-auto w-full max-w-4xl rounded-2xl transition-all duration-200',
          isSearchMatch && 'ring-1 ring-amber-300/70 ring-offset-2 ring-offset-background',
          isSearchActive && 'ring-2 ring-primary/55 shadow-[0_0_0_4px_rgba(255,111,0,0.08)]',
        )}
      >
        <div className="rounded-xl border border-amber-200/55 bg-amber-50/72 px-3 py-2 text-[13px] text-amber-900/90 shadow-[0_4px_14px_rgba(245,158,11,0.06)] dark:border-amber-500/15 dark:bg-amber-950/12 dark:text-amber-100/80">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-600/80 dark:text-amber-300/70" />
            <span className="shrink-0 text-[11px] font-medium text-amber-700/85 dark:text-amber-200/75">
              {t('systemNotice.label')}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-amber-900/75 dark:text-amber-100/70">
              {summary}
            </span>
            {message.timestamp ? (
              <span className="shrink-0 text-[11px] text-amber-700/60 dark:text-amber-200/55">
                {formatTimestamp(message.timestamp)}
              </span>
            ) : null}
            {showToggle ? (
              <button
                type="button"
                onClick={() => setSystemExpanded((value) => !value)}
                className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-amber-700/80 transition-colors hover:bg-amber-100/70 hover:text-amber-900 dark:text-amber-200/75 dark:hover:bg-amber-900/25 dark:hover:text-amber-100"
                aria-expanded={systemExpanded}
              >
                {systemExpanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                <span>{systemExpanded ? t('systemNotice.collapse') : t('systemNotice.expand')}</span>
              </button>
            ) : null}
          </div>
          {systemExpanded && hasText ? (
            <div className="mt-2 border-t border-amber-200/45 pt-2 dark:border-amber-500/10">
              <p className="whitespace-pre-wrap break-words break-all leading-6">{text}</p>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const isEmbeddedAssistant = hideAvatar && !isUser;

  return (
    <div
      data-chat-message-role={isUser ? 'user' : 'assistant'}
      data-chat-message-id={message.id ?? undefined}
      className={cn(
        'rounded-[1.6rem] transition-all duration-200',
        isSearchMatch && 'ring-1 ring-primary/25 ring-offset-2 ring-offset-background',
        isSearchActive && 'ring-2 ring-primary/55 bg-primary/[0.04] shadow-[0_0_0_4px_rgba(255,111,0,0.08)]',
        isEmbeddedAssistant ? 'w-full' : 'flex gap-3 group',
        !isEmbeddedAssistant && (isUser ? 'flex-row-reverse' : 'flex-row'),
      )}
    >
      {/* Avatar */}
      {!isUser && !hideAvatar && (
        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-border bg-[linear-gradient(180deg,#FFF5E6,#FFE8CC)] text-primary shadow-[0_8px_20px_rgba(255,111,0,0.12)]">
          <Sparkles className="h-4 w-4" />
        </div>
      )}

      {/* Content */}
      <div
        className={cn(
          'flex flex-col w-full min-w-0 space-y-2',
          !isEmbeddedAssistant && 'max-w-[80%]',
          isUser ? 'items-end' : 'items-start',
        )}
      >
        {isStreaming && !isUser && streamingTools.length > 0 && !showThinking && (
          <ToolStatusBar tools={streamingTools} />
        )}

        {showThinkingPanel && (
          <ThinkingProcessPanel
            timeline={thinkingTimeline}
            isStreaming={isStreaming && !isUser}
            streamingTools={isStreaming ? streamingTools : []}
          />
        )}

        {/* Tool use cards */}
        {visibleTools.length > 0 && (
          <div className="space-y-1">
            {visibleTools.map((tool, i) => (
              <ToolCard key={tool.id || i} name={tool.name} input={tool.input} />
            ))}
          </div>
        )}

        {/* Images — rendered ABOVE text bubble for user messages */}
        {/* Images from content blocks (Gateway session data / channel push photos) */}
        {isUser && images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => {
              const src = imageSrc(img);
              if (!src) return null;
              return (
                <ImageThumbnail
                  key={`content-${i}`}
                  src={src}
                  fileName="image"
                  base64={img.data}
                  mimeType={img.mimeType}
                  onPreview={() => setLightboxImg({ src, fileName: 'image', base64: img.data, mimeType: img.mimeType })}
                />
              );
            })}
          </div>
        )}

        {/* File attachments — images above text for user, file cards below */}
        {isUser && hasRenderableFiles && (
          <div className="flex flex-wrap gap-2">
            {attachedFiles.map((file, i) => {
              const isImage = file.mimeType.startsWith('image/');
              // Skip image attachments if we already have images from content blocks
              if (isImage && images.length > 0) return null;
              if (isImage) {
                return file.preview ? (
                  <ImageThumbnail
                    key={`local-${i}`}
                    src={file.preview}
                    fileName={file.fileName}
                    filePath={file.filePath}
                    mimeType={file.mimeType}
                    onPreview={() => setLightboxImg({ src: file.preview!, fileName: file.fileName, filePath: file.filePath, mimeType: file.mimeType })}
                  />
                ) : (
                  <div
                    key={`local-${i}`}
                    className="flex h-36 w-36 items-center justify-center rounded-2xl border border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(245,246,247,0.95))] text-muted-foreground"
                  >
                    <File className="h-8 w-8" />
                  </div>
                );
              }
              // All non-image attachments render as FileCard
              return <FileCard key={`local-${i}`} file={file} onPreviewFile={onPreviewFile} />;
            })}
          </div>
        )}

        {/* Main text bubble */}
        {hasText && (
          <MessageBubble
            text={text}
            isUser={isUser}
            isStreaming={isStreaming}
            streamingLabel={t('streaming.respondingBadge')}
            completedLabel={t('streaming.completedLabel')}
            completedBadge={t('streaming.completedBadge')}
            onPreviewFile={onPreviewFile}
          />
        )}

        {/* Workflow execution card */}
        {workflowCard && (
          <WorkflowCard
            runId={workflowCard.runId}
            templateName={workflowCard.templateName}
            onPreviewArtifact={onPreviewFile}
            onViewWorkflow={onViewWorkflow}
            onCreateScheduledTask={onCreateScheduledTask}
          />
        )}

        {/* Parameter form card */}
        {parameterForm && (
          <ParameterFormCard
            key={`${parameterForm.formContext.sourceId}:${parameterForm.formContext.schemaHash ?? parameterForm.formId}`}
            config={parameterForm.formConfig}
            context={parameterForm.formContext}
            onSubmit={async (values) => {
              const ok = await submitParameterForm(parameterForm.formId, values);
              if (!ok) {
                toast.error('表单提交失败，请刷新页面后重试');
              }
            }}
          />
        )}

        {/* Images from content blocks — assistant messages (below text) */}
        {!isUser && images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => {
              const src = imageSrc(img);
              if (!src) return null;
              return (
                <ImagePreviewCard
                  key={`content-${i}`}
                  src={src}
                  fileName="image"
                  base64={img.data}
                  mimeType={img.mimeType}
                  onPreview={() => setLightboxImg({ src, fileName: 'image', base64: img.data, mimeType: img.mimeType })}
                />
              );
            })}
          </div>
        )}

        {/* File attachments — assistant messages (below text) */}
        {!isUser && previewFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {previewFiles.map((file, i) => {
              const isImage = file.mimeType.startsWith('image/');
              if (isImage && images.length > 0) return null;
              if (isImage && file.preview) {
                return (
                  <ImagePreviewCard
                    key={`preview-${normalizePreviewFileKey(file.filePath, file.fileName) || i}`}
                    src={file.preview}
                    fileName={file.fileName}
                    filePath={file.filePath}
                    mimeType={file.mimeType}
                    onPreview={() => setLightboxImg({ src: file.preview!, fileName: file.fileName, filePath: file.filePath, mimeType: file.mimeType })}
                  />
                );
              }
              if (isImage && !file.preview) {
                return (
                  <div key={`preview-${i}`} className="flex h-36 w-36 items-center justify-center rounded-2xl border border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(245,246,247,0.95))] text-muted-foreground">
                    <File className="h-8 w-8" />
                  </div>
                );
              }
              return (
                <FileCard
                  key={`preview-${normalizePreviewFileKey(file.filePath, file.fileName) || i}`}
                  file={file}
                  onPreviewFile={onPreviewFile}
                />
              );
            })}
          </div>
        )}

        {/* Hover row for user messages — timestamp + quick actions */}
        {isUser && hasText && (
          <UserHoverBar
            text={text}
            timestamp={message.timestamp}
            onEditMessage={onEditMessage}
          />
        )}

        {/* Hover row for assistant messages — only when there is real text content */}
        {!isUser && hasText && (
          <AssistantHoverBar
            text={text}
            timestamp={message.timestamp}
            onCopyDebugSnapshot={showRenderDebugPanel ? copyDebugSnapshot : undefined}
          />
        )}
      </div>

      {/* Image lightbox portal */}
      {lightboxImg && (
        <ImageLightbox
          src={lightboxImg.src}
          fileName={lightboxImg.fileName}
          filePath={lightboxImg.filePath}
          base64={lightboxImg.base64}
          mimeType={lightboxImg.mimeType}
          onClose={() => setLightboxImg(null)}
        />
      )}
    </div>
  );
});

function formatDuration(durationMs?: number): string | null {
  if (!durationMs || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function ToolStatusBar({
  tools,
}: {
  tools: Array<{
    id?: string;
    toolCallId?: string;
    name: string;
    status: 'running' | 'completed' | 'error';
    durationMs?: number;
    summary?: string;
  }>;
}) {
  return (
    <div className="w-full space-y-1">
      {tools.map((tool) => {
        const duration = formatDuration(tool.durationMs);
        const isRunning = tool.status === 'running';
        const isError = tool.status === 'error';
        return (
          <div
            key={tool.toolCallId || tool.id || tool.name}
            className={cn(
              'flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs transition-all duration-300',
              isRunning && 'border-[hsl(var(--primary)/0.35)] bg-[linear-gradient(135deg,rgba(255,245,230,0.95),rgba(255,232,204,0.75))] text-foreground shadow-[0_8px_18px_rgba(255,111,0,0.08)]',
              !isRunning && !isError && cn('border-border text-muted-foreground', assistantChatCardBg),
              isError && 'border-destructive/30 bg-destructive/5 text-destructive',
            )}
          >
            {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />}
            {!isRunning && !isError && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />}
            {isError && <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
            <Wrench className="h-3 w-3 shrink-0 opacity-60" />
            <span className="font-mono text-[12px] font-medium">{tool.name}</span>
            {duration && <span className="text-[11px] opacity-60">{tool.summary ? `(${duration})` : duration}</span>}
            {tool.summary && (
              <span className="truncate text-[11px] opacity-70">{tool.summary}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function UserHoverBar({
  text,
  timestamp,
  onEditMessage,
}: {
  text: string;
  timestamp?: number;
  onEditMessage?: (text: string) => void;
}) {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);

  const copyContent = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      console.error('[ChatMessage] Failed to copy user message:', error);
      toast.error(t('messageActions.copyFailed'));
    }
  }, [text, t]);

  const editAgain = useCallback(() => {
    if (onEditMessage) {
      onEditMessage(text);
      return;
    }
    window.dispatchEvent(new CustomEvent(CHAT_EDIT_DRAFT_EVENT, { detail: { text } }));
  }, [onEditMessage, text]);

  return (
    <div className="flex select-none items-center gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
      {timestamp ? (
        <span className="mr-1 text-xs text-muted-foreground">
          {formatTimestamp(timestamp)}
        </span>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 rounded-full border border-border bg-white/75 text-muted-foreground shadow-sm hover:bg-white hover:text-foreground dark:bg-background/70 dark:hover:bg-background"
        onClick={copyContent}
        title={t('messageActions.copy')}
      >
        {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 rounded-full border border-border bg-white/75 text-muted-foreground shadow-sm hover:bg-white hover:text-foreground dark:bg-background/70 dark:hover:bg-background"
        onClick={editAgain}
        title={t('messageActions.editAndResend')}
      >
        <Pencil className="h-3 w-3" />
      </Button>
    </div>
  );
}

// ── Assistant hover bar (timestamp + copy, shown on group hover) ─

function AssistantHoverBar({
  text,
  timestamp,
  onCopyDebugSnapshot,
}: {
  text: string;
  timestamp?: number;
  onCopyDebugSnapshot?: () => Promise<void> | void;
}) {
  const [copied, setCopied] = useState(false);

  const copyContent = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <div className="flex w-full select-none items-center justify-between px-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
      <span className="text-xs text-muted-foreground">
        {timestamp ? formatTimestamp(timestamp) : ''}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 rounded-full border border-border bg-primary/[0.04] hover:bg-primary/[0.08]"
        onClick={copyContent}
        onDoubleClick={() => {
          if (!onCopyDebugSnapshot) return;
          void onCopyDebugSnapshot();
        }}
        title={onCopyDebugSnapshot ? '单击复制内容，双击复制调试快照' : undefined}
      >
        {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      </Button>
    </div>
  );
}

/** Allow custom preview:// links — react-markdown strips unknown URL schemes by default. */
function previewUrlTransform(url: string): string {
  if (url.startsWith('preview://')) return url;
  return defaultUrlTransform(url);
}

// ── Message Bubble ──────────────────────────────────────────────

function MessageBubble({
  text,
  isUser,
  isStreaming,
  streamingLabel,
  completedLabel,
  completedBadge,
  onPreviewFile,
}: {
  text: string;
  isUser: boolean;
  isStreaming: boolean;
  streamingLabel: string;
  completedLabel: string;
  completedBadge: string;
  onPreviewFile?: (file: AttachedFileMeta) => void;
}) {
  const showStreamingChrome = isStreaming && !isUser;
  const workflowCardStates = useChatStore((s) => s.workflowCardStates);
  const markdownSource = useMemo(
    () => (onPreviewFile ? preprocessTextForPreviewLinks(text) : text),
    [text, onPreviewFile],
  );

  useEffect(() => {
    if (isUser || !isFilePreviewDebugEnabled()) return;
    logFilePreview('markdown-render', {
      isStreaming,
      hasOnPreviewFile: !!onPreviewFile,
      rawTextPreview: text.slice(0, 600),
      markdownSourcePreview: markdownSource.slice(0, 900),
      rawLength: text.length,
      markdownLength: markdownSource.length,
      containsPreviewScheme: markdownSource.includes('preview://'),
      containsFilePreviewTag: /\[file-preview:/i.test(text),
      containsInlineCodePaths: /`[^`]*\.(?:md|txt|html?|json|csv|py|js)[^`]*`/i.test(text),
      unwrappedPreview: unwrapPreviewablePathMarkdown(text).slice(0, 900),
      preprocessChanged: markdownSource !== text,
    });
  }, [isUser, text, markdownSource, onPreviewFile, isStreaming]);

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl px-4 py-3 transition-[background-color,border-color,box-shadow] duration-300',
        !isUser && 'w-full',
        isUser
          ? cn(
              'border text-foreground',
              'border-border dark:border-white/12',
              'bg-[linear-gradient(165deg,hsl(var(--primary)/0.26),hsl(var(--primary)/0.11))]',
              'dark:bg-[linear-gradient(165deg,hsl(var(--primary)/0.45),hsl(var(--primary)/0.22))]',
              'shadow-[0_10px_26px_rgba(255,111,0,0.12),inset_0_1px_0_0_hsl(var(--glass-highlight)/0.45)]',
              'dark:shadow-[0_8px_28px_rgba(255,111,0,0.18),inset_0_1px_0_0_hsl(var(--glass-highlight)/0.18)]',
            )
          : showStreamingChrome
            ? cn(
                'border border-border text-foreground shadow-[0_0_0_1px_rgba(15,23,42,0.04),0_18px_34px_rgba(15,23,42,0.08)]',
                'dark:border-border dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_14px_32px_rgba(0,0,0,0.45)]',
                assistantChatCardBgStreaming,
              )
            : cn(
                'border border-border text-foreground shadow-[0_12px_28px_rgba(15,23,42,0.08)]',
                'dark:border-border dark:shadow-[0_10px_28px_rgba(0,0,0,0.4)]',
                assistantChatCardBg,
              ),
      )}
    >
      {showStreamingChrome && (
        <>
          <motion.div
            className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-primary/10 to-transparent"
            initial={{ x: '-120%' }}
            animate={{ x: '120%' }}
            transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
        </>
      )}

      {isUser ? (
        <p className="whitespace-pre-wrap break-words break-all text-sm">
          {renderUserMessageMentionNodes(text)}
        </p>
      ) : (
        <div className="prose prose-sm max-w-none break-words break-all text-sm leading-normal dark:prose-invert">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            urlTransform={previewUrlTransform}
            components={{
              p({ children }) {
                return <p>{highlightAtMentionsInChildren(children)}</p>;
              },
              li({ children }) {
                return <li>{highlightAtMentionsInChildren(children)}</li>;
              },
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const isInline = !match && !className;
                if (isInline) {
                  return (
                    <code className="rounded-md bg-background/55 px-1.5 py-0.5 text-sm font-mono break-all break-words text-foreground" {...props}>
                      {children}
                    </code>
                  );
                }
                return (
                  <pre className="overflow-x-auto rounded-xl border border-border bg-background/55 p-4">
                    <code className={cn('text-sm font-mono', className)} {...props}>
                      {children}
                    </code>
                  </pre>
                );
              },
              a({ href, children }) {
                const rawHref = typeof href === 'string' ? href.trim() : '';

                if (!rawHref) {
                  return <span className="text-link break-words break-all">{children}</span>;
                }

                const target = resolvePreviewLinkTarget(rawHref, workflowCardStates);

                if (onPreviewFile && isHttpUrl(target) && isPreviewableRemoteUrl(target)) {
                  const previewFile = artifactToPreviewFile({
                    name: previewHttpUrlLabel(target),
                    type: inferMimeTypeFromUrl(target),
                    url: target,
                  });
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        logFilePreview('link-click', { branch: 'remote-preview', target });
                        onPreviewFile(previewFile);
                      }}
                      className="inline border-0 bg-transparent p-0 font-inherit text-link hover:underline break-words break-all cursor-pointer"
                    >
                      {children}
                    </button>
                  );
                }

                if (isHttpUrl(target)) {
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        logFilePreview('link-click', { branch: 'external-http', target });
                        openExternalUrl(target);
                      }}
                      className="inline border-0 bg-transparent p-0 font-inherit text-link hover:underline break-words break-all cursor-pointer"
                    >
                      {children}
                    </button>
                  );
                }

                if (onPreviewFile && target) {
                  const fileName = target.split('/').pop() || 'preview';
                  const mimeType = inferMimeTypeFromUrl(target);
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        logFilePreview('link-click', { branch: 'local-preview', target, fileName, mimeType });
                        onPreviewFile({
                          filePath: target,
                          fileName,
                          mimeType,
                          fileSize: 0,
                          preview: null,
                        });
                      }}
                      className="inline border-0 bg-transparent p-0 font-inherit text-link hover:underline break-words break-all cursor-pointer"
                    >
                      {children}
                    </button>
                  );
                }

                return (
                  <span className="text-link break-words break-all">{children}</span>
                );
              },
            }}
          >
            {markdownSource}
          </ReactMarkdown>
          {isStreaming && (
            <StreamingCursor />
          )}
        </div>
      )}

      {showStreamingChrome && (
        <div className="relative mt-3 flex items-center justify-between gap-3 border-t border-border pt-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2 min-w-0">
            <StreamingPulse />
            <span className="truncate font-medium tracking-[0.02em] text-foreground/80">
              {streamingLabel}
            </span>
          </div>
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.24em] text-primary/70">
            输出中
          </span>
        </div>
      )}
      {!isUser && !isStreaming && (
        <div className="relative mt-3 flex items-center justify-between gap-3 border-t border-border/30 pt-2">
          <span className="truncate text-[10px] text-muted-foreground/45">{completedLabel}</span>
          <span className="shrink-0 flex items-center gap-1 text-[10px] font-medium text-emerald-500/70 dark:text-emerald-400/60">
            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {completedBadge}
          </span>
        </div>
      )}
    </div>
  );
}

/** Wrap local file paths and web URLs in preview:// markdown links so ReactMarkdown can render them as clickable buttons. */
function preprocessTextForPreviewLinks(text: string): string {
  // Unwrap path-only ``` / `inline` blocks and plain path lines before code protection.
  text = unwrapPreviewablePathMarkdown(text);

  // Protect code blocks and inline code from being modified
  const codeBlocks: string[] = [];
  text = text.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  const inlineCodes: string[] = [];
  text = text.replace(/`[^`]*`/g, (match) => {
    inlineCodes.push(match);
    return `__INLINE_CODE_${inlineCodes.length - 1}__`;
  });

  // Remove [media attached: ...] blocks so their inner paths don't get mangled
  // and the raw metadata isn't shown in the message bubble.
  text = text.replace(/\s*\[media attached:[^\]]*\]/g, '');

  // Convert [file-preview: path] (model-invented tag) into a normal preview markdown link.
  text = text.replace(/\s*\[file-preview:\s*([^\]]+)\]/gi, (_match, rawPath: string) => {
    const path = rawPath.trim();
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) {
      const label = safeDecodeURIComponent(path.split('/').pop()?.split('?')[0] || '查看预览');
      return `[${label}](${path})`;
    }
    if (path.startsWith('preview://')) {
      const target = toMarkdownPreviewPath(path.slice('preview://'.length));
      return `[${target}](preview://${target})`;
    }
    const safe = toMarkdownPreviewPath(path);
    return `[${safe}](preview://${safe})`;
  });

  // Protect existing markdown links [text](url) — keep http(s) URLs intact (preview://https:// breaks ReactMarkdown).
  const mdLinks: string[] = [];
  text = text.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (match, linkText, href) => {
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('preview://')) {
      mdLinks.push(match);
    } else {
      mdLinks.push(`[${linkText}](${href})`);
    }
    return `__MD_LINK_${mdLinks.length - 1}__`;
  });

  // Replace file:// URLs — strip the scheme and wrap the underlying local path
  // file:///C:/... → C:/... ; file:///Users/... → /Users/...
  // Regex consumes file:// (2 slashes), capture group gets the 3rd slash + path.
  // For Windows: /C:/Users/... → strip leading / → C:/Users/...
  // For Unix: /Users/... → keep as-is → /Users/...
  // The result is placed in a __FILE_URL__ placeholder to prevent the path regex
  // from double-wrapping the extracted path.
  const fileUrlPlaceholders: string[] = [];
  text = text.replace(
    /file:\/\/(\/[A-Za-z]:[\\/][^\s)\]"',;<>]+|\/[^\s)\]"',;<>]+)/g,
    (_match, captured) => {
      // Strip leading / for Windows paths (/C:/ → C:/), keep for Unix (/Users/ → /Users/)
      const filePath = captured.match(/^\/[A-Za-z]:/) ? captured.slice(1) : captured;
      const safe = toMarkdownPreviewPath(filePath);
      fileUrlPlaceholders.push(`[${safe}](preview://${safe})`);
      return `__FILE_URL_${fileUrlPlaceholders.length - 1}__`;
    },
  );

  // Replace previewable http(s) URLs — keep real href (do NOT prefix preview://)
  text = text.replace(
    /(https?:\/\/[^\s)\]"',;<>]+)/gi,
    (rawUrl) => {
      const url = rawUrl.replace(/[.,;:!?)}\]]+$/, '');
      if (!isPreviewableRemoteUrl(url)) return rawUrl;
      const label = previewHttpUrlLabel(url);
      return `[${label}](${url})`;
    },
  );

  // Replace file paths (relative ./, absolute /, and Windows C:\)
  // Lookbehind (?<![\\w./:]) rejects matches that are part of a URL path component
  // (e.g. "/report.html" inside "https://example.com/report.html").
  text = text.replace(
    new RegExp(`(?<![\\w./:])(\\./(?:[^/\\n\\r]+\\/)*[^/\\n\\r]+\\.(?:${PREVIEWABLE_FILE_EXTS})|\\/(?:[^/\\n\\r]+\\/)*[^/\\n\\r]+\\.(?:${PREVIEWABLE_FILE_EXTS})|[A-Za-z]:[\\\\/](?:[^/\\n\\r]+[\\\\/])*[^/\\n\\r]+\\.(?:${PREVIEWABLE_FILE_EXTS}))`, 'g'),
    (match) => {
      const safe = toMarkdownPreviewPath(match);
      return `[${safe}](preview://${safe})`;
    },
  );

  // Wrap bare filenames (e.g. "查看产物: anomaly_config_params.html") into markdown links.
  text = text.replace(
    /(?<![\w./:])([\w][\w.-]*\.(?:html?|pdf|json|md|txt|csv))(?![\w.])/gi,
    (filename) => `[${filename}](${filename})`,
  );

  // Restore file URL placeholders (before other restores so markdown links don't interfere)
  text = text.replace(/__FILE_URL_(\d+)__/g, (_, i) => fileUrlPlaceholders[Number(i)]);

  // Restore markdown links
  text = text.replace(/__MD_LINK_(\d+)__/g, (_, i) => mdLinks[Number(i)]);

  // Restore inline code
  text = text.replace(/__INLINE_CODE_(\d+)__/g, (_, i) => inlineCodes[Number(i)]);

  // Restore code blocks
  text = text.replace(/__CODE_BLOCK_(\d+)__/g, (_, i) => codeBlocks[Number(i)]);

  return text;
}

function StreamingCursor() {
  return (
    <motion.span
      className="ml-1 inline-flex h-[0.95rem] w-6 rounded-full align-[-0.1em] bg-primary/45 shadow-[0_0_0_1px_rgba(255,111,0,0.18)]"
      animate={{
        opacity: [0.35, 1, 0.45],
        scaleX: [0.92, 1.08, 0.96],
      }}
      transition={{
        duration: 1.4,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
    />
  );
}

function StreamingPulse() {
  return (
    <div className="relative flex h-2.5 w-2.5 items-center justify-center">
      <motion.span
        className="absolute h-2.5 w-2.5 rounded-full bg-primary/25"
        animate={{ scale: [0.8, 1.8], opacity: [0.45, 0] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
      />
      <motion.span
        className="relative h-1.5 w-1.5 rounded-full bg-primary"
        animate={{ scale: [0.92, 1.15, 0.92] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}

// ── File Card (for user-uploaded non-image files) ───────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType.startsWith('video/')) return <Film className={className} />;
  if (mimeType.startsWith('audio/')) return <Music className={className} />;
  // CSV / TSV — tabular data, show spreadsheet icon before generic text/ fallback
  if (mimeType === 'text/csv' || mimeType === 'text/tab-separated-values') return <Table2 className={className} />;
  if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') return <FileText className={className} />;
  if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive') || mimeType.includes('tar') || mimeType.includes('rar') || mimeType.includes('7z')) return <FileArchive className={className} />;
  if (mimeType === 'application/pdf') return <FileText className={className} />;
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel'
  ) return <Table2 className={className} />;
  return <File className={className} />;
}

function FileCard({ file, onPreviewFile }: { file: AttachedFileMeta; onPreviewFile?: (file: AttachedFileMeta) => void }) {
  const isPreviewable = isPreviewableFile(file);

  const handleOpen = useCallback(() => {
    logFilePreview('file-card-click', {
      filePath: file.filePath,
      fileName: file.fileName,
      mimeType: file.mimeType,
      isPreviewable,
      hasOnPreviewFile: !!onPreviewFile,
    });
    if (onPreviewFile && isPreviewable) {
      onPreviewFile(file);
    } else if (file.filePath?.startsWith('http://') || file.filePath?.startsWith('https://')) {
      openExternalUrl(file.filePath);
    } else if (file.filePath) {
      invokeIpc('shell:openPath', file.filePath);
    }
  }, [file, onPreviewFile, isPreviewable]);

  return (
    <div
      className={cn(
        'flex max-w-[220px] items-center gap-3 rounded-2xl border border-border px-3 py-2.5 shadow-[0_10px_24px_rgba(15,23,42,0.06)]',
        assistantChatCardBg,
        (file.filePath || onPreviewFile) && 'cursor-pointer transition-all hover:border-muted-foreground/35 hover:bg-white/[0.97] dark:hover:bg-white/[0.12]',
      )}
      onClick={handleOpen}
      title={isPreviewable ? '点击预览' : file.filePath ? '打开文件' : undefined}
    >
      <FileIcon mimeType={file.mimeType} className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 overflow-hidden">
        <p className="text-xs font-medium truncate">{file.fileName}</p>
        <p className="text-[10px] text-muted-foreground">
          {file.fileSize > 0 ? formatFileSize(file.fileSize) : 'File'}
        </p>
      </div>
      {isPreviewable && onPreviewFile && (
        <span className="ml-auto shrink-0 text-[10px] text-primary">预览</span>
      )}
    </div>
  );
}

// ── Image Thumbnail (user bubble — square crop with zoom hint) ──

function ImageThumbnail({
  src,
  fileName,
  filePath,
  base64,
  mimeType,
  onPreview,
}: {
  src: string;
  fileName: string;
  filePath?: string;
  base64?: string;
  mimeType?: string;
  onPreview: () => void;
}) {
  void filePath; void base64; void mimeType;
  return (
    <div
      className="group/img relative h-36 w-36 cursor-zoom-in overflow-hidden rounded-2xl border border-border bg-white/30 shadow-[0_10px_24px_rgba(15,23,42,0.08)] dark:bg-white/[0.08]"
      onClick={onPreview}
    >
      <img src={src} alt={fileName} className="w-full h-full object-cover" />
      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/25 transition-colors flex items-center justify-center">
        <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover/img:opacity-100 transition-opacity drop-shadow" />
      </div>
    </div>
  );
}

// ── Image Preview Card (assistant bubble — natural size with overlay actions) ──

function ImagePreviewCard({
  src,
  fileName,
  filePath,
  base64,
  mimeType,
  onPreview,
}: {
  src: string;
  fileName: string;
  filePath?: string;
  base64?: string;
  mimeType?: string;
  onPreview: () => void;
}) {
  void filePath; void base64; void mimeType;
  return (
    <div
      className={cn(
        'group/img relative max-w-xs cursor-zoom-in overflow-hidden rounded-2xl border border-border shadow-[0_10px_24px_rgba(15,23,42,0.08)]',
        assistantChatCardBg,
      )}
      onClick={onPreview}
    >
      <img src={src} alt={fileName} className="block w-full" />
      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition-colors flex items-center justify-center">
        <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover/img:opacity-100 transition-opacity drop-shadow" />
      </div>
    </div>
  );
}

// ── Image Lightbox ───────────────────────────────────────────────

function ImageLightbox({
  src,
  fileName,
  filePath,
  base64,
  mimeType,
  onClose,
}: {
  src: string;
  fileName: string;
  filePath?: string;
  base64?: string;
  mimeType?: string;
  onClose: () => void;
}) {
  void src; void base64; void mimeType; void fileName;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleShowInFolder = useCallback(() => {
    if (filePath) {
      invokeIpc('shell:showItemInFolder', filePath);
    }
  }, [filePath]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Image + buttons stacked */}
      <div
        className="flex flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={fileName}
          className="max-w-[90vw] max-h-[85vh] rounded-lg shadow-2xl object-contain"
        />

        {/* Action buttons below image */}
        <div className="flex items-center gap-2">
          {filePath && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 bg-white/10 hover:bg-white/20 text-white"
              onClick={handleShowInFolder}
              title="在文件夹中显示"
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 bg-white/10 hover:bg-white/20 text-white"
            onClick={onClose}
            title="关闭"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Tool Card ───────────────────────────────────────────────────

function ToolCard({ name, input }: { name: string; input: unknown }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        'rounded-2xl border border-border text-[14px] shadow-[0_10px_24px_rgba(15,23,42,0.06)]',
        assistantChatCardBg,
      )}
    >
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setExpanded(!expanded)}
      >
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
        <Wrench className="h-3 w-3 shrink-0 opacity-60" />
        <span className="font-mono text-xs">{name}</span>
        {expanded ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
      </button>
      {expanded && input != null && (
        <pre className="overflow-x-auto px-3 pb-3 text-xs text-muted-foreground">
          {typeof input === 'string' ? input : JSON.stringify(input, null, 2) as string}
        </pre>
      )}
    </div>
  );
}
