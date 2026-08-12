/**
 * Chat Message Component
 * Renders user / assistant / system / toolresult messages
 * with markdown, thinking sections, images, and tool cards.
 */
import { useState, useCallback, useEffect, useMemo, useRef, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, Check, Pencil, ChevronDown, ChevronRight, Wrench, File, X, FolderOpen, ZoomIn, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import { chatRemarkPlugins } from '@/lib/remark-gfm-chat';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ChatToolCallCard } from '@/components/chat/chat-tool-call-card';
import { ChatProcessLoadingEllipsis } from '@/components/chat/chat-process-loading-ellipsis';
import { useTypewriterReveal } from '@/hooks/use-typewriter-reveal';
import { cn } from '@/lib/utils';
import { assistantChatCardBg, userChatBubbleSurfaceClass, workflowParamsSummaryCardClass, workflowParamsSummaryGroupClass, workflowParamsSummaryGroupContentClass, workflowParamsSummaryGroupTitleClass, workflowParamsSummaryGroupsClass } from '@/lib/surfaces';
import {
  isChatResponsePending,
  isCurrentUserTurnIncomplete,
  isLastUserMessage,
  isMessageInCurrentUserTurn,
  isTurnDisplayAssistantMessage,
} from '@/pages/Chat/chat-turn-meta';
import { canShowAssistantTurnMeta, resolveCurrentTurnLifecycleForMeta } from '@/pages/Chat/turn-lifecycle';
import { invokeIpc } from '@/lib/api-client';
import type { RawMessage, AttachedFileMeta } from '@/stores/chat';
import { useChatStore } from '@/stores/chat';
import { useChatSessionRuntimeView } from '@/stores/chat/runtime-selectors';
import {
  extractText,
  extractPlainTextFromContent,
  extractImages,
  extractToolUse,
  extractThinkingTimeline,
  formatTimestamp,
  extractPreviewableRefs,
  extractDisplayFileNameHints,
  isPreviewableFile,
  PREVIEWABLE_FILE_EXTS,
  useLocalPathExistence,
  resolvePreviewCandidate,
  unwrapPreviewablePathMarkdown,
  findWorkflowParamsSummaryAfterIntro,
  isWorkflowStartAssistantBoilerplate,
  resolveAssistantCopyShareContent,
  resolveUserBubbleActionText,
  splitUserBubbleAtTag,
} from './message-utils';
import { writeCopyShareTextToClipboard } from '@/lib/copy-share-clipboard';
import {
  ensureWorkflowParameterFormHandler,
  ensureWorkflowParameterFormInjected,
  isLastAssistantAfterUserTurn,
  resolveParameterFormForAssistantMessage,
} from '@/stores/chat/parameter-form-recovery';
import {
  artifactToPreviewFile,
  inferMimeTypeFromUrl,
  isHttpUrl,
  openExternalUrl,
  previewHttpUrlLabel,
  resolvePreviewLinkTarget,
  toMarkdownPreviewPath,
} from '@/lib/preview-url';
import type { WorkflowExecutionState } from '@/types/workflow';

const EMPTY_WORKFLOW_CARD_STATES: Record<string, WorkflowExecutionState> = {};
import {
  coerceHrefForMarkdownTransform,
  resolvePreviewHrefAction,
  resolvePreviewPathOnHost,
} from '@/lib/preview-href';
import { applyDisplayNameHints, dedupeAttachedFiles, mergePreviewFileLists, normalizePreviewFileKey, previewFileRefsMatch } from '@/lib/preview-file-path';
import { safeDecodeURIComponent } from '@/lib/safe-decode-uri';
import { isFilePreviewDebugEnabled, logFilePreview } from '@/lib/file-preview-debug';
import { ParameterFormCard } from '@/components/parameter-form/ParameterFormCard';
import { PARAMETER_FORM_USE_FLOAT_DOCK } from '@/components/parameter-form/constants';
import { submitParameterForm } from '@/components/parameter-form/form-handlers';
import {
  isPartialWorkflowGuidanceStreamingText,
  isWorkflowGuidanceAssistantText,
  parseWorkflowIntroConfirmStepGroups,
  parseWorkflowParamsSummaryGroups,
  isWorkflowParameterIntroText,
  isWorkflowParamsUserText,
  isWorkflowParamsSummaryText,
  splitWorkflowIntroPreamble,
} from '@/lib/workflow-form-utils';
import {
  ArtifactProductCard,
  buildArtifactMetaLine,
  formatArtifactFileSize,
} from '@/components/chat/artifact-product-card';
import { buildArtifactCardMenuItems } from '@/lib/artifact-card-menu';
import { highlightAtMentionsInChildren } from '@/lib/at-mention-highlight';
import { renderUserMessageMentionNodes } from '@/components/dingtalk/DingTalkMentionTag';
import { SkillMessageTag } from '@/components/skill-plaza/SkillMessageTag';
import type { SkillMeta } from '@/types/skill-meta';
import { AwaitingReplyIndicator, ThinkingProcessPanel } from './ThinkingProcessPanel';
import { ArtifactShareDialog } from '@/components/file-preview/ArtifactShareDialog';
import { ShareMessageIcon } from '@/components/icons/ShareMessageIcon';
import { QuickInputIcon } from '@/components/icons/composer-toolbar-icons';
import { SaveAsQuickInputButton } from '@/components/quick-input/SaveAsQuickInputButton';
import {
  buildConversationShareDialogDraft,
  type DingTalkShareDialogDraft,
} from '@/lib/dingtalk-share';
import { CHAT_EDIT_DRAFT_EVENT } from '@/components/input-composer';
import type { PersistedComposerSegment } from '@/lib/dingtalk-mention-composer';
import {
  parseWorkflowRunDisplayText,
  synthesizeComposerSegments,
  UserComposerSegmentsContent,
  UserWorkflowMessageTag,
} from '@/components/input-composer/user-composer-segments';

interface ChatMessageProps {
  message: RawMessage;
  sessionMessages: RawMessage[];
  showThinking: boolean;
  /** 搜索稳定键：写入 data-chat-search-key，供索引/高亮/滚动定位 */
  searchMessageKey?: string;
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
  onCreateScheduledTask?: (workflowId: string) => void;
  onEditMessage?: (
    text: string,
    skillMeta?: SkillMeta,
    options?: {
      segments?: PersistedComposerSegment[];
      attachments?: AttachedFileMeta[];
    },
  ) => void;
  /** Used when rendered inside AssistantTurnMessage */
  hideAvatar?: boolean;
  hideThinkingPanel?: boolean;
  /** 父级已展示思考面板时，正文内不再重复渲染工具卡 */
  suppressToolCards?: boolean;
  /** AssistantTurnMessage 合并展示的同轮最终回复，视为该轮 meta 挂载点 */
  isTurnDisplayReply?: boolean;
}

const HOVER_REVEAL_CLASS = 'opacity-0 transition-opacity duration-200 group-hover:opacity-100';

const MESSAGE_META_ICON_BUTTON_CLASS =
  'h-auto w-auto min-h-0 min-w-0 shrink-0 rounded-none border-0 bg-transparent p-0.5 text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground';

const MESSAGE_META_SHARE_ICON_CLASS = 'h-3.5 w-3.5';

interface ExtractedImage { url?: string; data?: string; mimeType: string; }

/** Resolve an ExtractedImage to a displayable src string, or null if not possible. */
function imageSrc(img: ExtractedImage): string | null {
  if (img.url) return img.url;
  if (img.data) return `data:${img.mimeType};base64,${img.data}`;
  return null;
}

export const ChatMessage = memo(function ChatMessage({
  message,
  sessionMessages,
  showThinking,
  searchMessageKey,
  isSearchMatch = false,
  isSearchActive = false,
  isStreaming = false,
  streamingTools = [],
  onPreviewFile,
  onEditMessage,
  hideThinkingPanel = false,
  suppressToolCards = false,
  isTurnDisplayReply = false,
}: ChatMessageProps) {
  const { t } = useTranslation('chat');
  const isUser = message.role === 'user';
  const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
  const isSystem = role === 'system';
  const isToolResult = role === 'toolresult' || role === 'tool_result';
  const text = extractText(message);
  const skillMeta = message._skillMeta ?? message._skillMetas?.[0];
  const hasText = text.trim().length > 0;
  const showUserSkillBubble = isUser && Boolean(skillMeta);
  /** Text for copy/share on a user bubble (skill title + body); see helper. */
  const userActionText = useMemo(
    () => resolveUserBubbleActionText(text, skillMeta),
    [text, skillMeta],
  );
  const [systemExpanded, setSystemExpanded] = useState(false);
  const images = extractImages(message);
  const tools = extractToolUse(message);
  const thinkingTimeline = showThinking ? extractThinkingTimeline(message) : [];
  const showThinkingPanel =
    !hideThinkingPanel &&
    showThinking &&
    (thinkingTimeline.length > 0 || (isStreaming && streamingTools.length > 0));
  const visibleTools = showThinking || suppressToolCards ? [] : tools;

  const attachedFiles = useMemo(
    () => dedupeAttachedFiles(message._attachedFiles || []),
    [message._attachedFiles],
  );
  const composerSegmentsForRender = useMemo(
    () => synthesizeComposerSegments(message, text, skillMeta, attachedFiles),
    [message, text, skillMeta, attachedFiles],
  );
  const useSegmentBubble = isUser && Boolean(composerSegmentsForRender?.length);
  const messageIndex = useMemo(
    () => (message.id ? sessionMessages.findIndex((m) => m.id === message.id) : -1),
    [message.id, sessionMessages],
  );
  const introParamsFallbackText = useMemo(() => {
    if (isUser || !isWorkflowParameterIntroText(text) || isWorkflowParamsSummaryText(text)) {
      return null;
    }
    if (messageIndex < 0) return null;
    return findWorkflowParamsSummaryAfterIntro(sessionMessages, messageIndex);
  }, [isUser, text, messageIndex, sessionMessages]);
  const [lightboxImg, setLightboxImg] = useState<{ src: string; fileName: string; filePath?: string; base64?: string; mimeType?: string } | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareDraft, setShareDraft] = useState<DingTalkShareDialogDraft | null>(null);
  const pendingWorkflow = useChatStore(
    (s) => s.workflowChatUiBySessionKey[s.currentSessionKey]?.pendingWorkflow ?? null,
  );
  const sessionKey = useChatStore((s) => s.currentSessionKey);
  const workflowCardStates = EMPTY_WORKFLOW_CARD_STATES;
  const workflowCard = null;
  const isWorkflowCompletionMessage = false;
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
      extractPreviewableRefs(text, { messageId: message.id })
        .filter((ref) => !attachedFiles.some((f) => previewFileRefsMatch(f, ref)))
        .filter((ref) => isPreviewableFile(ref)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, message.id, message._attachedFiles],
  );
  const candidateLocalPaths = useMemo(
    () => candidateRefs.filter((ref) => !isHttpUrl(ref.filePath)).map((ref) => ref.filePath),
    [candidateRefs],
  );
  const refExistence = useLocalPathExistence(candidateLocalPaths);
  const workflowArtifactUrls = useMemo(() => {
    const urls = new Set<string>();
    for (const state of Object.values(workflowCardStatesForRefs)) {
      if (state?.status !== 'completed') continue;
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
      const exists = refExistence[ref.filePath];
      const resolved = resolvePreviewCandidate(
        { ...ref, fileSize: 0, preview: null },
        exists,
        workflowCardStatesForRefs,
      );
      if (!resolved) {
        logFilePreview('extract-filtered', {
          messageId: message.id,
          filePath: ref.filePath,
          fileName: ref.fileName,
          exists: exists ?? null,
          reason: exists === false
            ? 'local path does not exist and no workflow artifact fallback'
            : 'existence check pending or unresolvable',
        });
        continue;
      }
      const key = normalizePreviewFileKey(resolved.filePath, resolved.fileName);
      if (seen.has(key)) continue;
      if (workflowArtifactUrls.has(resolved.filePath)) continue;
      seen.add(key);
      result.push({ filePath: resolved.filePath, fileName: resolved.fileName, mimeType: resolved.mimeType });
    }
    return result;
  }, [candidateRefs, refExistence, workflowCardStatesForRefs, workflowArtifactUrls, message.id]);

  const displayNameHints = useMemo(() => extractDisplayFileNameHints(text), [text]);

  const previewFiles = useMemo(
    () => isWorkflowCompletionMessage ? [] : applyDisplayNameHints(
      mergePreviewFileLists(
        attachedFiles,
        extractedRefs.map((ref) => ({ ...ref, fileSize: 0, preview: null })),
      ),
      displayNameHints,
    ),
    [isWorkflowCompletionMessage, attachedFiles, extractedRefs, displayNameHints],
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

  const hasStreamingToolStatus = isStreaming && streamingTools.length > 0;
  const isWorkflowThinkingContext =
    pendingWorkflow !== null || parameterForm !== null || workflowCard !== null;
  const isAssistantParamsSummary = !isUser && isWorkflowParamsSummaryText(text);
  const isAssistantWorkflowGuidance =
    !isUser && !isAssistantParamsSummary && isWorkflowGuidanceAssistantText(text);
  const hasWorkflowSchemaToolStream = streamingTools.some((tool) =>
    /get_workflow_schema|workflow_schema|search_workflow/i.test(tool.name),
  );
  /** 工作流引导流式生成：走描边参数卡，不用 MessageBubble 脉冲/投影壳 */
  const isWorkflowIntroStreaming =
    isStreaming
    && !isUser
    && (
      pendingWorkflow !== null
      || parameterForm !== null
      || isAssistantWorkflowGuidance
      || isPartialWorkflowGuidanceStreamingText(text)
      || hasWorkflowSchemaToolStream
    );
  const showAssistantParamsPanel =
    isAssistantParamsSummary
    || isAssistantWorkflowGuidance
    || isWorkflowIntroStreaming
    || (!isUser && introParamsFallbackText !== null);
  const assistantParamsPanelText = isAssistantParamsSummary
    ? text
    : isAssistantWorkflowGuidance || isWorkflowIntroStreaming
      ? text
      : (introParamsFallbackText ?? '');
  const workflowGuidanceStreamingShell =
    !isUser
    && isStreaming
    && (
      pendingWorkflow !== null
      || parameterForm !== null
      || isAssistantWorkflowGuidance
      || hasWorkflowSchemaToolStream
    );
  const showAssistantParamsFold =
    !isUser && workflowCard !== null && /参数已确认/.test(text);
  const assistantBubbleText =
    (showAssistantParamsFold && isWorkflowStartAssistantBoilerplate(text)) || isWorkflowCompletionMessage ? '' : text;
  const showAssistantTextBubble = assistantBubbleText.trim().length > 0;
  const assistantCopyShareContent = useMemo(
    () => {
      if (isUser) {
        return { text: userActionText.trim(), files: previewFiles };
      }
      return resolveAssistantCopyShareContent({
        text,
        assistantBubbleText,
        workflowCard,
        workflowCardStates,
        sessionKey,
        previewFiles,
      });
    },
    [isUser, text, userActionText, assistantBubbleText, workflowCard, workflowCardStates, sessionKey, previewFiles],
  );
  const showUserParamsFold = isUser && hasText && isWorkflowParamsUserText(text);

  const { sending, pendingFinal, activeRunId, lastUserMessageAt } = useChatSessionRuntimeView(sessionKey);
  const isLastAssistantInTurn = !isUser && (
    isTurnDisplayReply || isTurnDisplayAssistantMessage(message, sessionMessages)
  );
  const isInCurrentUserTurn = isMessageInCurrentUserTurn(message, sessionMessages);
  const isLastUserInTurn = isUser && isLastUserMessage(message, sessionMessages);
  /** 与 AwaitingReplyIndicator 同口径：表单待提交时轮次未结束 */
  const isAwaitingUserToContinue =
    parameterForm !== null && workflowCard === null && !showAssistantParamsFold;
  /** 工作流 / 填表阻塞（不含 sending 等 runtime 字段，供 TurnLifecycle 分层） */
  const hasWorkflowBlockers = useMemo(
    () =>
      isCurrentUserTurnIncomplete({
        sessionMessages,
        sending: false,
        lastUserMessageAt: null,
        pendingFinal: false,
        activeRunId: null,
        workflowCardStates,
        hasPendingWorkflowSchema: pendingWorkflow?.schema != null,
        sessionKey,
      }),
    [sessionMessages, workflowCardStates, pendingWorkflow?.schema, sessionKey],
  );
  const turnLifecycle = useMemo(
    () =>
      resolveCurrentTurnLifecycleForMeta({
        sending,
        pendingFinal,
        lastUserMessageAt,
        activeRunId,
        isStreaming,
        isAwaitingUserToContinue,
        hasWorkflowBlockers,
        runId: activeRunId,
      }),
    [
      sending,
      pendingFinal,
      lastUserMessageAt,
      activeRunId,
      isStreaming,
      isAwaitingUserToContinue,
      hasWorkflowBlockers,
    ],
  );
  const hasAssistantMetaContent =
    showAssistantTextBubble
    || workflowCard !== null
    || previewFiles.length > 0
    || showAssistantParamsFold;
  /** 每轮助手回复结束后，在产物/正文下方常态展示复制 + 时间（TurnLifecycle.canShowMeta） */
  const showAssistantMessageMeta = canShowAssistantTurnMeta({
    hasAssistantMetaContent,
    isLastAssistantInTurn,
    isInCurrentUserTurn,
    lifecycle: turnLifecycle,
  });
  /** 用户参数摘要卡由同轮最后一条助手消息统一展示 meta，避免出现在「参数已确认」上方 */
  const showUserMessageMeta =
    (hasText || Boolean(skillMeta) || useSegmentBubble)
    && !showUserParamsFold
    // A background workflow can keep the turn non-terminal after the assistant
    // has acknowledged the start. Keep user shortcuts available in that state;
    // hide them only while the chat response itself is still in flight.
    && !(isLastUserInTurn && isChatResponsePending({
      sending,
      lastUserMessageAt,
      pendingFinal,
      activeRunId,
    }));

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
      await writeCopyShareTextToClipboard({ text: snapshot });
      toast.success('已复制渲染调试快照');
    } catch {
      toast.error('复制失败，请重试');
    }
  }, [debugLinks, debugMarkdownSource, text]);

  const openConversationShare = useCallback(() => {
    setShareDraft(buildConversationShareDialogDraft(
      assistantCopyShareContent.text,
      assistantCopyShareContent.files,
    ));
    setShareDialogOpen(true);
  }, [assistantCopyShareContent, setShareDialogOpen, setShareDraft]);

  const handleShareCompleted = useCallback(() => {
    toast.success(t('preview.shareDialog.success'));
    setShareDialogOpen(false);
    setShareDraft(null);
  }, [setShareDialogOpen, setShareDraft, t]);

  // Never render tool result messages in chat UI
  if (isToolResult || (
    !hasText
    && !skillMeta
    && !showThinkingPanel
    && images.length === 0
    && visibleTools.length === 0
    && !hasRenderableFiles
    && extractedRefs.length === 0
    && !hasStreamingToolStatus
    && !parameterForm
    && !workflowCard
    && !showAssistantParamsFold
    && !showAssistantParamsPanel
  )) {
    return null;
  }

  if (isSystem) {
    const compactText = text.replace(/\s+/g, ' ').trim();
    const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || compactText;
    const summary = firstLine.length > 88 ? `${firstLine.slice(0, 88)}…` : firstLine;
    const showToggle = compactText.length > summary.length || text.includes('\n');
    return (
      <div
        data-chat-message-role="system"
        data-chat-message-id={message.id ?? undefined}
        data-chat-search-key={searchMessageKey}
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
      data-chat-search-key={searchMessageKey}
      className={cn(
        'rounded-[1.6rem] transition-all duration-200',
        isSearchMatch && 'ring-1 ring-primary/25 ring-offset-2 ring-offset-background',
        isSearchActive && 'ring-2 ring-primary/55 bg-primary/[0.04] shadow-[0_0_0_4px_rgba(255,111,0,0.08)]',
        thinkingOutsideAvatar
          ? 'flex w-full flex-col gap-2'
          : isUser && showUserParamsFold
            ? 'group w-full'
            : isUser
              ? 'group flex flex-row-reverse gap-3'
              : 'w-full',
      )}
    >
      {thinkingOutsideAvatar ? (
        <ThinkingProcessPanel
          message={message}
          isStreaming={isStreaming && !isUser}
          streamingTools={isStreaming ? streamingTools : []}
          hasReplyBody={!isUser && hasText}
          connectingLabelKey={isWorkflowThinkingContext ? 'connectingModel' : 'understandingQuestion'}
        />
      ) : null}

      {/* Content */}
      <div
        className={cn(
          'flex flex-col w-full min-w-0 space-y-2',
          isUser && !showUserParamsFold && 'max-w-[80%]',
          isUser && showUserParamsFold && 'max-w-none items-stretch',
          isUser && !showUserParamsFold ? 'items-end' : 'items-start',
        )}
      >
        {isStreaming && !isUser && streamingTools.length > 0 && !showThinking && !hideThinkingPanel && (
          <ToolStatusBar tools={streamingTools} />
        )}

        {!thinkingOutsideAvatar && showThinkingPanel && (
          <ThinkingProcessPanel
            message={message}
            isStreaming={isStreaming && !isUser}
            streamingTools={isStreaming ? streamingTools : []}
            hasReplyBody={!isUser && hasText}
            connectingLabelKey={isWorkflowThinkingContext ? 'connectingModel' : 'understandingQuestion'}
          />
        )}

        {/* Tool use cards */}
        {visibleTools.length > 0 && (
          <div className="space-y-2">
            {visibleTools.map((tool, i) => (
              <ChatToolCallCard key={tool.id || i} name={tool.name} input={tool.input} />
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
        {isUser && hasRenderableFiles && !useSegmentBubble && (
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

        {/* B4：用户参数摘要 fallback（无 intro 时可见，无标题） */}
        {showUserParamsFold ? (
          <ParamsConfirmedParamsOnlyPanel text={text} />
        ) : null}

        {/* Main text bubble */}
        {!showUserParamsFold && !showAssistantParamsPanel && (isUser ? (hasText || showUserSkillBubble || useSegmentBubble) : showAssistantTextBubble) ? (
          isUser ? (
            <MessageBubble
              text={text}
              skillMeta={skillMeta}
              composerSegments={composerSegmentsForRender ?? undefined}
              isUser={isUser}
              isStreaming={isStreaming}
              onPreviewFile={onPreviewFile}
              workflowGuidanceShell={workflowGuidanceStreamingShell}
            />
          ) : (
            <MessageBubble
              text={assistantBubbleText}
              isUser={isUser}
              isStreaming={isStreaming}
              replyStreamKey={message.id ?? `assistant-${message.timestamp ?? 'stream'}`}
              onPreviewFile={onPreviewFile}
              workflowGuidanceShell={workflowGuidanceStreamingShell}
            />
          )
        ) : null}

        {/* B4：分组参数（助手 A / 旧数据 fallback，无标题无白底） */}
        {showAssistantParamsPanel ? (
          !isUser ? (
            <ParamsConfirmedParamsOnlyPanel
              text={assistantParamsPanelText}
              isStreaming={isWorkflowIntroStreaming}
            />
          ) : null
        ) : null}

        {/* B3：表单待提交等待指示；工作流已提交/执行后不再展示 */}
        {parameterForm && workflowCard === null && !showAssistantParamsFold ? (
          <AwaitingReplyIndicator className="px-0.5" />
        ) : null}

        {/* Parameter form card — 任务二：浮层开启时内联挂载隐藏（恢复：设 PARAMETER_FORM_USE_FLOAT_DOCK=false） */}
        {parameterForm && !PARAMETER_FORM_USE_FLOAT_DOCK ? (
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
        {!isUser && previewFiles.length > 0 && (
          <div className="flex w-full flex-col gap-2">
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

        {/* 助手消息：复制 + 分享 + 时间 — 置于正文/工作流/产物等全部内容之后 */}
        {!isUser && showAssistantMessageMeta ? (
          <AssistantMessageMetaRow
            copyShareContent={assistantCopyShareContent}
            timestamp={message.timestamp}
            onCopyDebugSnapshot={showRenderDebugPanel ? copyDebugSnapshot : undefined}
            onShare={openConversationShare}
          />
        ) : null}

        {isUser && showUserMessageMeta ? (
          <UserMessageMetaRow
            copyText={userActionText}
            editText={text}
            skillMeta={skillMeta}
            composerSegments={composerSegmentsForRender ?? undefined}
            attachedFiles={attachedFiles}
            timestamp={message.timestamp}
            onEditMessage={onEditMessage}
            onShare={openConversationShare}
          />
        ) : null}
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

      <ArtifactShareDialog
        open={shareDialogOpen}
        draft={shareDraft}
        onShared={handleShareCompleted}
        onCancel={() => {
          setShareDialogOpen(false);
          setShareDraft(null);
        }}
        onError={(error) => {
          toast.error(error instanceof Error ? error.message : t('preview.shareDialog.failed'));
        }}
      />
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

function UserMessageMetaRow({
  copyText,
  editText,
  skillMeta,
  composerSegments,
  attachedFiles,
  timestamp,
  onEditMessage,
  onShare,
}: {
  copyText: string;
  editText: string;
  skillMeta?: SkillMeta;
  composerSegments?: PersistedComposerSegment[];
  attachedFiles?: AttachedFileMeta[];
  timestamp?: number;
  onEditMessage?: (
    text: string,
    skillMeta?: SkillMeta,
    options?: {
      segments?: PersistedComposerSegment[];
      attachments?: AttachedFileMeta[];
    },
  ) => void;
  onShare?: () => void;
}) {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);

  const copyContent = useCallback(async () => {
    try {
      await writeCopyShareTextToClipboard({ text: copyText });
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      console.error('[ChatMessage] Failed to copy user message:', error);
      toast.error(t('messageActions.copyFailed'));
    }
  }, [copyText, t]);

  const editAgain = useCallback(() => {
    const editOptions = composerSegments?.length
      ? {
        segments: composerSegments,
        attachments: attachedFiles,
      }
      : undefined;
    if (onEditMessage) {
      onEditMessage(editText, skillMeta, editOptions);
      return;
    }
    window.dispatchEvent(
      new CustomEvent(CHAT_EDIT_DRAFT_EVENT, {
        detail: {
          text: editText,
          skill: skillMeta,
          segments: composerSegments,
          attachments: attachedFiles?.map((file) => ({
            id: crypto.randomUUID(),
            fileName: file.fileName,
            mimeType: file.mimeType,
            fileSize: file.fileSize,
            preview: file.preview,
            filePath: file.filePath,
            stagedPath: file.filePath,
            status: file.filePath ? 'ready' : 'error',
          })),
        },
      }),
    );
  }, [attachedFiles, composerSegments, editText, onEditMessage, skillMeta]);

  return (
    <div className={cn('flex select-none items-center gap-2', HOVER_REVEAL_CLASS)}>
      {timestamp ? (
        <span className="mr-1 text-xs text-muted-foreground">
          {formatTimestamp(timestamp)}
        </span>
      ) : null}

      <SaveAsQuickInputButton content={copyText} className={MESSAGE_META_ICON_BUTTON_CLASS}>
        <QuickInputIcon className={cn(MESSAGE_META_SHARE_ICON_CLASS, 'text-current')} />
      </SaveAsQuickInputButton>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={MESSAGE_META_ICON_BUTTON_CLASS}
        onClick={copyContent}
        aria-label={t('messageActions.copy')}
        title={t('messageActions.copy')}
      >
        {copied ? <Check className="h-3 w-3 text-green-500" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
      </Button>
      {onShare ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={MESSAGE_META_ICON_BUTTON_CLASS}
          onClick={onShare}
          aria-label={t('messageActions.share')}
          title={t('messageActions.share')}
        >
          <ShareMessageIcon className={MESSAGE_META_SHARE_ICON_CLASS} />
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={MESSAGE_META_ICON_BUTTON_CLASS}
        onClick={editAgain}
        aria-label={t('messageActions.editAndResend')}
        title={t('messageActions.editAndResend')}
      >
        <Pencil className="h-3 w-3" aria-hidden />
      </Button>
    </div>
  );
}

/** 助手消息底栏：复制 + 分享 + 时间，常态展示于正文下方 */
function AssistantMessageMetaRow({
  copyShareContent,
  timestamp,
  onCopyDebugSnapshot,
  onShare,
}: {
  copyShareContent: { text: string; files: AttachedFileMeta[] };
  timestamp?: number;
  onCopyDebugSnapshot?: () => Promise<void> | void;
  onShare?: () => void;
}) {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);

  const hasCopyableText = copyShareContent.text.trim().length > 0;

  const copyText = useCallback(async () => {
    try {
      await writeCopyShareTextToClipboard({ text: copyShareContent.text });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success(t('messageActions.copyTextSuccess'));
    } catch (error) {
      console.error('[ChatMessage] Failed to copy assistant text:', error);
      toast.error(t('messageActions.copyFailed'));
    }
  }, [copyShareContent.text, t]);

  const copyTitle = onCopyDebugSnapshot
    ? '单击复制内容，双击复制调试快照'
    : t('messageActions.copy');

  const copyButtonIcon = copied
    ? <Check className="h-3 w-3 text-green-500" aria-hidden />
    : <Copy className="h-3 w-3" aria-hidden />;

  return (
    <div className="flex select-none items-center gap-2">
      {hasCopyableText ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={MESSAGE_META_ICON_BUTTON_CLASS}
          onClick={() => {
            void copyText();
          }}
          onDoubleClick={() => {
            if (!onCopyDebugSnapshot) return;
            void onCopyDebugSnapshot();
          }}
          aria-label={t('messageActions.copy')}
          title={copyTitle}
        >
          {copyButtonIcon}
        </Button>
      ) : null}
      {onShare ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={MESSAGE_META_ICON_BUTTON_CLASS}
          onClick={onShare}
          aria-label={t('messageActions.share')}
          title={t('messageActions.share')}
        >
          <ShareMessageIcon className={MESSAGE_META_SHARE_ICON_CLASS} />
        </Button>
      ) : null}
      {timestamp ? (
        <span className="text-xs text-muted-foreground">
          {formatTimestamp(timestamp)}
        </span>
      ) : null}
    </div>
  );
}

/** ReactMarkdown urlTransform — local hrefs → preview://; external schemes pass through. */
function previewUrlTransform(url: string): string {
  const coerced = coerceHrefForMarkdownTransform(url);
  if (coerced !== null) return coerced;
  return defaultUrlTransform(url);
}

// ── Message Bubble ──────────────────────────────────────────────

/** 技能标签按输入框里的落点渲染；无位置信息时退回正文最前。 */
function UserSkillBubbleContent({
  text,
  skillMeta,
}: {
  text: string;
  skillMeta: { slug: string; title: string; tagOffset?: number };
}) {
  const { before, after, padBefore, padAfter } = splitUserBubbleAtTag(text, skillMeta.tagOffset);
  return (
    <>
      {before ? renderUserMessageMentionNodes(before) : null}
      {padBefore ? '\u00A0' : null}
      <SkillMessageTag title={skillMeta.title} />
      {padAfter ? '\u00A0' : null}
      {after ? renderUserMessageMentionNodes(after) : null}
    </>
  );
}

function MessageBubble({
  text,
  skillMeta,
  composerSegments,
  isUser,
  isStreaming,
  replyStreamKey = 'assistant-reply',
  onPreviewFile,
  assistantVariant = 'default',
  workflowGuidanceShell = false,
}: {
  text: string;
  skillMeta?: { slug: string; title: string };
  composerSegments?: PersistedComposerSegment[];
  isUser: boolean;
  isStreaming: boolean;
  /** 流式正文打字机 reset key（message id） */
  replyStreamKey?: string;
  onPreviewFile?: (file: AttachedFileMeta) => void;
  /** B3 工作流就绪概述白卡 */
  assistantVariant?: 'default' | 'workflowOverview';
  /** 工作流引导流式：与数据来源同款的纯描边壳，无脉冲/投影底栏 */
  workflowGuidanceShell?: boolean;
}) {
  const showWorkflowGuidanceStreaming = isStreaming && !isUser && workflowGuidanceShell;
  const isReplyStream = isStreaming && !isUser && !workflowGuidanceShell;
  const wasReplyStreamRef = useRef(false);
  const [enableReplyTypewriter, setEnableReplyTypewriter] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const justStarted = isReplyStream && !wasReplyStreamRef.current;
    wasReplyStreamRef.current = isReplyStream;
    const nextValue = !isReplyStream ? false : justStarted ? text.length === 0 : null;
    if (nextValue === null) return undefined;
    const frameId = window.requestAnimationFrame(() => {
      setEnableReplyTypewriter((current) => current === nextValue ? current : nextValue);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [isReplyStream, text.length]);

  const { text: typewriterText, isAnimating: isReplyTypewriterAnimating } = useTypewriterReveal(
    text,
    enableReplyTypewriter,
    { resetKey: replyStreamKey },
  );
  const useReplyTypewriter =
    isReplyStream && (enableReplyTypewriter || isReplyTypewriterAnimating);
  const bubbleText = useReplyTypewriter ? typewriterText : text;

  const workflowCardStates = EMPTY_WORKFLOW_CARD_STATES;
  const userWorkflowDisplay = isUser ? parseWorkflowRunDisplayText(text) : null;
  const markdownSource = useMemo(
    () => (onPreviewFile ? preprocessTextForPreviewLinks(bubbleText) : bubbleText),
    [bubbleText, onPreviewFile],
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
        'relative transition-[border-color] duration-200',
        !isUser && 'w-full',
        isUser
          ? userChatBubbleSurfaceClass
          : cn(
              showWorkflowGuidanceStreaming
                ? cn(workflowParamsSummaryCardClass, 'text-[13px] leading-5 text-foreground')
                : 'rounded-2xl px-4 py-3',
              showWorkflowGuidanceStreaming
                ? null
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
      {isUser ? (
        <p className="whitespace-pre-wrap break-words break-all text-sm font-normal leading-5 text-foreground">
          {composerSegments?.length ? (
            <UserComposerSegmentsContent segments={composerSegments} />
          ) : userWorkflowDisplay ? (
            <>
              {userWorkflowDisplay.beforeText ? (
                <>
                  {renderUserMessageMentionNodes(userWorkflowDisplay.beforeText)}
                  {'\u00A0'}
                </>
              ) : null}
              <UserWorkflowMessageTag workflowName={userWorkflowDisplay.workflowName} />
              {userWorkflowDisplay.accompanyingText ? (
                <>
                  {'\u00A0'}
                  {renderUserMessageMentionNodes(userWorkflowDisplay.accompanyingText)}
                </>
              ) : null}
            </>
          ) : skillMeta ? (
            <UserSkillBubbleContent text={text} skillMeta={skillMeta} />
          ) : (
            text.trim().length > 0 ? renderUserMessageMentionNodes(text) : null
          )}
        </p>
      ) : (
        <div
          className="prose prose-sm prose-chat-reply min-w-0 max-w-none text-sm leading-6 text-foreground dark:prose-invert"
          aria-busy={useReplyTypewriter && enableReplyTypewriter ? true : undefined}
        >
          <ReactMarkdown
            remarkPlugins={chatRemarkPlugins}
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

                const action = resolvePreviewHrefAction(
                  rawHref.startsWith('preview://') ? rawHref : rawHref,
                );

                if (action.action === 'navigate-app') {
                  return (
                    <a
                      href={`#${action.path.startsWith('/') ? action.path : `/${action.path}`}`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        navigate(action.path);
                      }}
                      className="inline cursor-pointer break-all break-words font-inherit text-link underline-offset-2 hover:underline"
                    >
                      {children}
                    </a>
                  );
                }

                if (action.action === 'open-external') {
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        logFilePreview('link-click', { branch: 'external', target: action.url });
                        openExternalUrl(action.url);
                      }}
                      className="inline cursor-pointer break-all break-words border-0 bg-transparent p-0 font-inherit text-link underline-offset-2 hover:underline"
                    >
                      {children}
                    </button>
                  );
                }

                if (action.action === 'preview-remote' && onPreviewFile) {
                  const previewFile = artifactToPreviewFile({
                    name: previewHttpUrlLabel(action.url),
                    type: inferMimeTypeFromUrl(action.url),
                    url: action.url,
                  });
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        logFilePreview('link-click', { branch: 'remote-preview', target: action.url });
                        onPreviewFile(previewFile);
                      }}
                      className="inline cursor-pointer break-all break-words border-0 bg-transparent p-0 font-inherit text-link underline-offset-2 hover:underline"
                    >
                      {children}
                    </button>
                  );
                }

                if (action.action === 'preview-local' && onPreviewFile) {
                  const hintPath = action.path;
                  const workflowTarget = resolvePreviewLinkTarget(
                    rawHref.startsWith('preview://') ? rawHref : `preview://${hintPath}`,
                    workflowCardStates,
                  );
                  const openLocal = async () => {
                    let filePath = workflowTarget && isHttpUrl(workflowTarget)
                      ? workflowTarget
                      : hintPath;
                    if (!isHttpUrl(filePath)) {
                      const resolved = await resolvePreviewPathOnHost(filePath);
                      if (resolved.exists) filePath = resolved.path;
                    }
                    const fileName = filePath.split('/').pop()?.split('\\').pop() || 'preview';
                    logFilePreview('link-click', { branch: 'local-preview', target: filePath, fileName });
                    onPreviewFile({
                      filePath,
                      fileName,
                      mimeType: inferMimeTypeFromUrl(filePath),
                      fileSize: 0,
                      preview: null,
                    });
                  };
                  return (
                    <button
                      type="button"
                      onClick={() => { void openLocal(); }}
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
          {useReplyTypewriter && enableReplyTypewriter ? (
            <ChatProcessLoadingEllipsis />
          ) : null}
          {showWorkflowGuidanceStreaming ? (
            <div className={cn(workflowParamsSummaryGroupClass, 'mt-2')}>
              <p className={workflowParamsSummaryGroupTitleClass}>
                <Loader2
                  className="h-3.5 w-3.5 shrink-0 animate-spin text-primary"
                  aria-hidden
                />
              </p>
            </div>
          ) : null}
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
    if (
      href.startsWith('http://')
      || href.startsWith('https://')
      || href.startsWith('preview://')
      || href.startsWith('/skills')
      || href.startsWith('#/skills')
      || href.toLowerCase().startsWith('stoclaw://')
    ) {
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

  // Replace bare http(s) URLs with markdown links — keep real href (do NOT prefix preview://).
  // Extraction into file cards is disabled; click routing uses classifyPreviewHref (.sto → preview, else external).
  text = text.replace(
    /(https?:\/\/[^\s)\]"',;<>]+)/gi,
    (rawUrl) => {
      const url = rawUrl.replace(/[.,;:!?)}\]]+$/, '');
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
    if (onPreviewFile) {
      onPreviewFile(file);
      return;
    }
    if (file.filePath?.startsWith('http://') || file.filePath?.startsWith('https://')) {
      openExternalUrl(file.filePath);
    } else if (file.filePath) {
      invokeIpc('shell:openPath', file.filePath);
    }
  }, [file, onPreviewFile, isPreviewable]);

  const menuItems = useMemo(
    () => buildArtifactCardMenuItems(file, t),
    [file, t],
  );

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
      menuItems={menuItems}
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

// ── 参数已确认折叠面板（图二：按步骤分组、无白底、与对话流同宽）──

interface ParamsConfirmedGroupedBodyProps {
  groups: Array<{ title: string; content: string }>;
  fallbackText: string;
  /** 流式生成中：首组标题左侧展示 spinner（替代 MessageBubble 脉冲条） */
  isStreaming?: boolean;
}

/** 展开区：按表单页分组，分类标题 + 内容（MasterGo 148:046134） */
function ParamsConfirmedGroupedBody({
  groups,
  fallbackText,
  isStreaming = false,
}: ParamsConfirmedGroupedBodyProps) {
  if (groups.length === 0) {
    return (
      <p className={workflowParamsSummaryGroupContentClass}>{fallbackText}</p>
    );
  }

  return (
    <div className={workflowParamsSummaryGroupsClass}>
      {groups.map((group, index) => (
        <div key={`${group.title}-${index}`} className={workflowParamsSummaryGroupClass}>
          <p className={workflowParamsSummaryGroupTitleClass}>
            {isStreaming && index === 0 ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Loader2
                  className="h-3.5 w-3.5 shrink-0 animate-spin text-primary"
                  aria-hidden
                />
                <span className="min-w-0 truncate">{group.title}</span>
              </span>
            ) : (
              group.title
            )}
          </p>
          {group.content ? (
            <p className={workflowParamsSummaryGroupContentClass}>{group.content}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

interface ParamsConfirmedParamsOnlyPanelProps {
  text: string;
  /** 工作流 intro 流式中：首组标题左侧 spinner */
  isStreaming?: boolean;
}

/** 分组参数摘要（MasterGo 148:046134：圆角描边卡片，无「参数已确认」标题） */
function ParamsConfirmedParamsOnlyPanel({
  text,
  isStreaming = false,
}: ParamsConfirmedParamsOnlyPanelProps) {
  const { preamble, groups, isIntroLayout } = useMemo(() => {
    if (isWorkflowParamsSummaryText(text)) {
      return {
        preamble: '',
        groups: parseWorkflowParamsSummaryGroups(text),
        isIntroLayout: false,
      };
    }
    if (isWorkflowGuidanceAssistantText(text) || isPartialWorkflowGuidanceStreamingText(text)) {
      const { preamble: introPreamble, numberedBody } = splitWorkflowIntroPreamble(text);
      const introGroups = parseWorkflowIntroConfirmStepGroups(
        numberedBody.length > 0 ? numberedBody : text,
      );
      if (introGroups.length > 0 || introPreamble.length > 0) {
        return {
          preamble: introPreamble,
          groups: introGroups,
          isIntroLayout: true,
        };
      }
    }
    return {
      preamble: '',
      groups: parseWorkflowParamsSummaryGroups(text),
      isIntroLayout: false,
    };
  }, [text]);

  return (
    <div className={cn(workflowParamsSummaryCardClass, 'text-[13px] leading-5')}>
      {isIntroLayout && preamble ? (
        <p className={cn(workflowParamsSummaryGroupTitleClass, 'mb-2')}>{preamble}</p>
      ) : null}
      {isStreaming && groups.length === 0 && isIntroLayout ? (
        <div className={workflowParamsSummaryGroupClass}>
          <p className={workflowParamsSummaryGroupTitleClass}>
            <Loader2
              className="h-3.5 w-3.5 shrink-0 animate-spin text-primary"
              aria-hidden
            />
          </p>
        </div>
      ) : (
        <ParamsConfirmedGroupedBody
          groups={groups}
          fallbackText={isIntroLayout && preamble ? '' : text}
          isStreaming={isStreaming}
        />
      )}
    </div>
  );
}
