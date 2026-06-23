/**
 * Chat Message Component
 * Renders user / assistant / system / toolresult messages
 * with markdown, thinking sections, images, and tool cards.
 */
import { useState, useCallback, useEffect, useMemo, memo } from 'react';
import { Copy, Check, Pencil, ChevronDown, ChevronRight, Wrench, File, X, FolderOpen, ZoomIn, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
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
import { extractText, extractImages, extractToolUse, extractThinkingTimeline, formatTimestamp, extractPreviewableRefs, isPreviewableFile, PREVIEWABLE_FILE_EXTS, extractWorkflowCard, extractParameterForm, useLocalPathExistence, resolvePreviewCandidate, unwrapPreviewablePathMarkdown } from './message-utils';
import {
  ensureWorkflowParameterFormHandler,
  isWorkflowFormInjectionAllowed,
} from '@/stores/chat/parameter-form-recovery';
import { WorkflowCard } from '@/components/workflow/WorkflowCard';
import {
  artifactToPreviewFile,
  inferMimeTypeFromUrl,
  isHttpUrl,
  isPreviewableRemoteUrl,
  openExternalUrl,
  previewHttpUrlLabel,
  resolvePreviewLinkTarget,
} from '@/lib/preview-url';
import { safeDecodeURIComponent } from '@/lib/safe-decode-uri';
import { isFilePreviewDebugEnabled, logFilePreview } from '@/lib/file-preview-debug';
import { ParameterFormCard } from '@/components/parameter-form/ParameterFormCard';
import { PARAMETER_FORM_USE_FLOAT_DOCK } from '@/components/parameter-form/constants';
import { submitParameterForm } from '@/components/parameter-form/form-handlers';
import {
  ArtifactProductCard,
  buildArtifactMetaLine,
  formatArtifactFileSize,
} from '@/components/chat/artifact-product-card';
import { highlightAtMentionsInChildren } from '@/lib/at-mention-highlight';
import { renderUserMessageMentionNodes } from '@/components/dingtalk/DingTalkMentionTag';
import { AwaitingReplyIndicator, ThinkingProcessPanel } from './ThinkingProcessPanel';

const CHAT_EDIT_DRAFT_EVENT = 'stoclaw:chat-edit-draft';

/** B3：工作流参数引导文案（buildWorkflowParameterIntroText 产出） */
function isWorkflowParameterIntroText(content: string): boolean {
  return /即将运行工作流「/.test(content) || /请在下方.*表单/.test(content);
}

/** B4：用户侧参数确认摘要（workflow-local-turn / buildWorkflowValuesSummary） */
function isWorkflowParamsUserText(content: string): boolean {
  const trimmed = content.trim();
  return (
    trimmed === '参数已确认'
    || trimmed.startsWith('已确认以下参数')
    || /^启动工作流「/.test(trimmed)
  );
}

/** B4：助手侧启动 boilerplate，折叠行替代长文案 */
function isWorkflowStartAssistantBoilerplate(content: string): boolean {
  return /^参数已确认[，,].*工作流已在后台启动/.test(content.trim());
}

function parseWorkflowParamsDetailLines(content: string): { label: string; value: string }[] {
  const items: { label: string; value: string }[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/^[\s\-·]+/, '').trim();
    if (!line) continue;
    const match = line.match(/^([^：:]+)[：:]\s*(.+)$/);
    if (match) {
      items.push({ label: match[1].trim(), value: match[2].trim() });
    }
  }
  return items;
}

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

  const attachedFiles = message._attachedFiles || [];
  const [lightboxImg, setLightboxImg] = useState<{ src: string; fileName: string; filePath?: string; base64?: string; mimeType?: string } | null>(null);
  const pendingWorkflow = useChatStore((s) => s.pendingWorkflow);
  const sessionKey = useChatStore((s) => s.currentSessionKey);
  const sessionMessages = useChatStore((s) => s.messages);
  const workflowCard = !isUser ? extractWorkflowCard(message) : null;
  const parameterForm = useMemo(() => {
    if (isUser) return null;
    const hasNativeFormBlock = Array.isArray(message.content)
      && (message.content as import('@/stores/chat').ContentBlock[]).some(
        (b) => b.type === 'parameter_form' && b.formId && b.formConfig,
      );
    if (hasNativeFormBlock) {
      return extractParameterForm(message, pendingWorkflow);
    }
    if (!pendingWorkflow?.schema) return null;
    if (
      !isWorkflowFormInjectionAllowed(
        pendingWorkflow.templateId,
        sessionMessages,
        extractText,
        sessionKey,
        { allowLivePending: true },
      )
    ) {
      return null;
    }
    return extractParameterForm(message, pendingWorkflow);
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

  // Extract previewable refs from message text, then verify non-http paths:
  // local files must exist on disk; cloud-runtime paths resolve to artifact OSS
  // URLs or are dropped (no broken file cards).
  const workflowCardStatesForRefs = useChatStore((s) => s.workflowCardStates);
  const candidateRefs = useMemo(
    () =>
      extractPreviewableRefs(text)
        .filter((ref) => !attachedFiles.some((f) => f.filePath === ref.filePath))
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
      if (!resolved || seen.has(resolved.filePath)) continue;
      if (workflowArtifactUrls.has(resolved.filePath)) continue;
      seen.add(resolved.filePath);
      result.push({ filePath: resolved.filePath, fileName: resolved.fileName, mimeType: resolved.mimeType });
    }
    return result;
  }, [candidateRefs, refExistence, workflowCardStatesForRefs, workflowArtifactUrls]);

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

  // All attached files should render as cards (images as thumbnails, everything else as FileCard)
  const hasRenderableFiles = attachedFiles.length > 0;

  // Never render tool result messages in chat UI
  if (isToolResult) return null;

  const hasStreamingToolStatus = isStreaming && streamingTools.length > 0;
  const isWorkflowThinkingContext =
    pendingWorkflow !== null || parameterForm !== null || workflowCard !== null;
  const isWorkflowOverviewBubble =
    !isUser && (parameterForm !== null || (hasText && isWorkflowParameterIntroText(text)));
  const showAssistantParamsFold =
    !isUser && workflowCard !== null && /参数已确认/.test(text);
  const assistantBubbleText =
    showAssistantParamsFold && isWorkflowStartAssistantBoilerplate(text) ? '' : text;
  const showAssistantTextBubble = assistantBubbleText.trim().length > 0;
  const showUserParamsFold = isUser && hasText && isWorkflowParamsUserText(text);

  if (
    !hasText
    && !showThinkingPanel
    && images.length === 0
    && visibleTools.length === 0
    && !hasRenderableFiles
    && extractedRefs.length === 0
    && !hasStreamingToolStatus
    && !parameterForm
    && !showAssistantParamsFold
  ) {
    return null;
  }
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

  /** 助手消息不展示头像；思考过程单独占一行 */
  const thinkingOutsideAvatar = !isUser && showThinkingPanel && !hideThinkingPanel;

  return (
    <div
      data-chat-message-role={isUser ? 'user' : 'assistant'}
      data-chat-message-id={message.id ?? undefined}
      className={cn(
        'rounded-[1.6rem] transition-all duration-200',
        isSearchMatch && 'ring-1 ring-primary/25 ring-offset-2 ring-offset-background',
        isSearchActive && 'ring-2 ring-primary/55 bg-primary/[0.04] shadow-[0_0_0_4px_rgba(255,111,0,0.08)]',
        thinkingOutsideAvatar ? 'flex w-full flex-col gap-2' : isUser ? 'group flex flex-row-reverse gap-3' : 'group w-full',
      )}
    >
      {thinkingOutsideAvatar ? (
        <ThinkingProcessPanel
          timeline={thinkingTimeline}
          isStreaming={isStreaming && !isUser}
          streamingTools={isStreaming ? streamingTools : []}
          connectingLabelKey={isWorkflowThinkingContext ? 'connectingModel' : 'understandingQuestion'}
        />
      ) : null}

      {/* Content */}
      <div
        className={cn(
          'flex flex-col w-full min-w-0 space-y-2',
          isUser && 'max-w-[80%]',
          isUser ? 'items-end' : 'items-start',
        )}
      >
        {isStreaming && !isUser && streamingTools.length > 0 && !showThinking && (
          <ToolStatusBar tools={streamingTools} />
        )}

        {!thinkingOutsideAvatar && showThinkingPanel && (
          <ThinkingProcessPanel
            timeline={thinkingTimeline}
            isStreaming={isStreaming && !isUser}
            streamingTools={isStreaming ? streamingTools : []}
            connectingLabelKey={isWorkflowThinkingContext ? 'connectingModel' : 'understandingQuestion'}
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

        {/* B4：用户参数确认折叠卡 */}
        {showUserParamsFold ? (
          <ParamsConfirmedFoldCard text={text} />
        ) : null}

        {/* Main text bubble */}
        {!showUserParamsFold && (isUser ? hasText : showAssistantTextBubble) ? (
          <MessageBubble
            text={isUser ? text : assistantBubbleText}
            isUser={isUser}
            isStreaming={isStreaming}
            streamingLabel={t('streaming.respondingBadge')}
            completedLabel={t('streaming.completedLabel')}
            completedBadge={t('streaming.completedBadge')}
            onPreviewFile={onPreviewFile}
            assistantVariant={isWorkflowOverviewBubble ? 'workflowOverview' : 'default'}
          />
        ) : null}

        {/* B4：助手侧「参数已确认」折叠行（工作流卡前） */}
        {showAssistantParamsFold ? <ParamsConfirmedFoldRow /> : null}

        {/* Workflow execution card */}
        {workflowCard && (
          <WorkflowCard
            runId={workflowCard.runId}
            templateName={workflowCard.templateName}
            onPreviewArtifact={onPreviewFile}
            onViewWorkflow={onViewWorkflow}
          />
        )}

        {/* B3：表单待提交等待指示（选项卡本体样式属任务二） */}
        {parameterForm ? <AwaitingReplyIndicator className="px-0.5" /> : null}

        {/* Parameter form card — 任务二：浮层开启时内联挂载隐藏（恢复：设 PARAMETER_FORM_USE_FLOAT_DOCK=false） */}
        {parameterForm && !PARAMETER_FORM_USE_FLOAT_DOCK ? (
          <ParameterFormCard
            config={parameterForm.formConfig}
            context={parameterForm.formContext}
            onSubmit={async (values) => {
              const ok = await submitParameterForm(parameterForm.formId, values);
              if (!ok) {
                toast.error('表单提交失败，请刷新页面后重试');
              }
            }}
          />
        ) : null}

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
        {!isUser && (attachedFiles.length > 0 || extractedRefs.length > 0) && (
          <div className="flex w-full flex-col gap-2">
            {attachedFiles.map((file, i) => {
              const isImage = file.mimeType.startsWith('image/');
              if (isImage && images.length > 0) return null;
              if (isImage && file.preview) {
                return (
                  <ImagePreviewCard
                    key={`local-${i}`}
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
                  <div key={`local-${i}`} className="flex h-36 w-36 items-center justify-center rounded-2xl border border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(245,246,247,0.95))] text-muted-foreground">
                    <File className="h-8 w-8" />
                  </div>
                );
              }
              // All non-image attachments render as FileCard
              return <FileCard key={`local-${i}`} file={file} onPreviewFile={onPreviewFile} />;
            })}
            {extractedRefs.map((ref, i) => (
              <FileCard
                key={`extracted-${i}`}
                file={{ ...ref, fileSize: 0, preview: null }}
                onPreviewFile={onPreviewFile}
              />
            ))}
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

/** 用户消息气泡（MasterGo 8:3912 Background）：#F0F2F5 底 / 12px 圆角 / 12px 内距 / 无边框无阴影 */
const userMessageBubbleSurfaceClass =
  'rounded-xl bg-[#F0F2F5] p-3 text-foreground shadow-none';

function MessageBubble({
  text,
  isUser,
  isStreaming,
  streamingLabel,
  completedLabel,
  completedBadge,
  onPreviewFile,
  assistantVariant = 'default',
}: {
  text: string;
  isUser: boolean;
  isStreaming: boolean;
  streamingLabel: string;
  completedLabel: string;
  completedBadge: string;
  onPreviewFile?: (file: AttachedFileMeta) => void;
  /** B3 工作流就绪概述白卡 */
  assistantVariant?: 'default' | 'workflowOverview';
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
        'relative overflow-hidden transition-[background-color,border-color,box-shadow] duration-300',
        !isUser && 'w-full',
        isUser
          ? userMessageBubbleSurfaceClass
          : cn(
              'rounded-2xl px-4 py-3',
              showStreamingChrome
                ? cn(
                    'border border-border text-foreground shadow-[0_0_0_1px_rgba(15,23,42,0.04),0_18px_34px_rgba(15,23,42,0.08)]',
                    'dark:border-border dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_14px_32px_rgba(0,0,0,0.45)]',
                    assistantChatCardBgStreaming,
                  )
                : assistantVariant === 'workflowOverview'
                  ? cn(
                      'w-full border border-border bg-card px-4 py-3 text-foreground shadow-soft',
                      'dark:border-border dark:bg-card',
                    )
                  : cn(
                      'w-full text-foreground',
                      assistantChatCardBg,
                    ),
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
        <p className="whitespace-pre-wrap break-words break-all text-sm font-normal leading-6 text-foreground">
          {renderUserMessageMentionNodes(text)}
        </p>
      ) : (
        <div className="prose prose-sm prose-chat-reply max-w-none break-words break-all text-sm leading-6 text-foreground dark:prose-invert">
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
              table({ children }) {
                return (
                  <div className="prose-table-wrap">
                    <table>{children}</table>
                  </div>
                );
              },
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const isInline = !match && !className;
                if (isInline) {
                  return (
                    <code
                      className="rounded-sm bg-muted px-1 py-0.5 text-xs font-mono break-all break-words text-foreground"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                }
                return (
                  <pre className="overflow-x-auto rounded-lg border border-border bg-[#F4F5F7] p-4 dark:bg-muted/40">
                    <code className={cn('text-[13px] leading-5 font-mono text-foreground', className)} {...props}>
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
                      className="inline cursor-pointer break-all break-words border-0 bg-transparent p-0 font-inherit text-link underline-offset-2 hover:underline"
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
                      className="inline cursor-pointer break-all break-words border-0 bg-transparent p-0 font-inherit text-link underline-offset-2 hover:underline"
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
                      className="inline cursor-pointer break-all break-words border-0 bg-transparent p-0 font-inherit text-link underline-offset-2 hover:underline"
                    >
                      {children}
                    </button>
                  );
                }

                return (
                  <span className="break-all break-words text-link">{children}</span>
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
          <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-success/70">
            <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden />
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
      const target = path.slice('preview://'.length);
      return `[${target}](preview://${target})`;
    }
    return `[${path}](preview://${path})`;
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
      fileUrlPlaceholders.push(`[${filePath}](preview://${filePath})`);
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
    '[$1](preview://$1)',
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

// ── File Card (assistant / user attachments → 产物卡样式) ─────────

function FileCard({ file, onPreviewFile }: { file: AttachedFileMeta; onPreviewFile?: (file: AttachedFileMeta) => void }) {
  const { t } = useTranslation('chat');
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

  const metaLine = buildArtifactMetaLine({
    fileName: file.fileName,
    mimeType: file.mimeType,
    fileSize: file.fileSize,
    formatFileSize: formatArtifactFileSize,
    t,
  });

  return (
    <ArtifactProductCard
      title={file.fileName}
      metaLine={metaLine}
      onAction={handleOpen}
    />
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

/** B4：助手侧「参数已确认」折叠行（与思考折叠摘要同款视觉） */
function ParamsConfirmedFoldRow() {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="w-full rounded-lg border border-border bg-[#F4F5F7] text-[13px] leading-[18px] dark:bg-muted">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-3 py-2.5 text-muted-foreground transition-colors duration-150 hover:text-foreground"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
        )}
        <span className="truncate font-normal">{t('streaming.paramsConfirmedLabel')}</span>
      </button>
    </div>
  );
}

/** B4：用户侧参数回填只读卡（折叠展示 buildWorkflowValuesSummary 文本） */
function ParamsConfirmedFoldCard({ text }: { text: string }) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);
  const detailLines = useMemo(() => parseWorkflowParamsDetailLines(text), [text]);

  return (
    <div className="w-full max-w-[85%] rounded-lg border border-border bg-[#F4F5F7] text-[13px] leading-[18px] dark:bg-muted">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-3 py-2.5 text-muted-foreground transition-colors duration-150 hover:text-foreground"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
        )}
        <span className="truncate font-normal">{t('streaming.paramsConfirmedLabel')}</span>
      </button>
      {expanded ? (
        <div className="space-y-2 border-t border-[#F0F1F2] px-3 pb-3 pt-2.5 dark:border-border">
          {detailLines.length > 0 ? (
            detailLines.map((item) => (
              <div
                key={`${item.label}-${item.value}`}
                className="rounded-lg border border-border bg-card px-3 py-2.5"
              >
                <p className="text-sm font-semibold text-foreground">{item.label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.value}</p>
              </div>
            ))
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{text}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

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
