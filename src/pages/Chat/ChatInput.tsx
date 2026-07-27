/**
 * Chat Input Component
 * Rich mention editor with send button and universal file upload support.
 * Enter to send, Shift+Enter for new line.
 * Supports: native file picker, clipboard paste, drag & drop.
 * Files are staged to disk via IPC — only lightweight path references
 * are sent with the message (no base64 over WebSocket).
 */
import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import {
  SendHorizontal,
  Square,
  X,
  Paperclip,
  FileText,
  Film,
  Music,
  FileArchive,
  File,
  Loader2,
  AtSign,
  Bot,
  Workflow,
  ArrowUp,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { hostApiFetch } from '@/lib/host-api';
import { invokeIpc } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  chatComposerHomeShellClass,
  chatComposerHomeShellDragOverClass,
  chatComposerHomeShellIdleClass,
  stoChatShellHomeClass,
} from '@/lib/surfaces';
import { useGatewayStore } from '@/stores/gateway';
import { resolveAgentById, useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { getProjectIdFromProjectAgentId } from '../../../shared/project-agent';
import { useSessionCatalogStore } from '@/stores/session-catalog';
import type { AgentSummary } from '@/types/agent';
import { useTranslation } from 'react-i18next';
import { DingTalkMentionEditor, type DingTalkMentionEditorHandle } from '@/components/dingtalk/DingTalkMentionEditor';
import { DingTalkMentionPopover } from '@/components/dingtalk/DingTalkMentionPopover';
import { WorkflowPicker } from '@/components/workflow/WorkflowPicker';
import { WorkflowComposerProgress } from '@/components/workflow/WorkflowComposerProgress';
import { SkillPicker } from '@/components/skill-plaza/SkillPicker';

import { useDingTalkMention } from '@/hooks/useDingTalkMention';

import type { ActiveMentionTrigger, MentionComposerSnapshot } from '@/lib/dingtalk-mention-composer';
import { extractSkillInlineQuery /*, hasSkillInlineTrigger */ } from '@/lib/dingtalk-mention-composer';
import type { DingTalkMention, MentionSearchItem } from '@/types/dingtalk-mention';
import type { SkillMeta } from '@/types/skill-meta';
import { mentionSearchItemToMention } from '@/types/dingtalk-mention';
import { inferMimeTypeFromPath } from '@/lib/preview-url';

// ── Types ────────────────────────────────────────────────────────

const CHAT_EDIT_DRAFT_EVENT = 'stoclaw:chat-edit-draft';

function logDingTalkMentionClient(message: string, data: unknown): void {
  void hostApiFetch('/api/logs/client', {
    method: 'POST',
    body: JSON.stringify({
      level: 'info',
      message,
      data,
    }),
  }).catch(() => undefined);
}

export interface FileAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  stagedPath: string;        // disk path for gateway
  preview: string | null;    // data URL for images, null for others
  status: 'staging' | 'ready' | 'error';
  error?: string;
}

interface ChatInputProps {
  onSend: (
    text: string,
    attachments?: FileAttachment[],
    targetAgentId?: string | null,
    dingTalkMentions?: DingTalkMention[],
    workflowId?: string | null,
    workflowSource?: string | null,
    workflowName?: string | null,
    skillMeta?: SkillMeta,
  ) => void;
  onStop?: () => void;
  onQueue?: (
    text: string,
    attachments?: FileAttachment[],
    targetAgentId?: string | null,
    dingTalkMentions?: DingTalkMention[],
    workflowId?: string | null,
    skillMeta?: SkillMeta,
  ) => void;
  disabled?: boolean;
  sending?: boolean;
  isEmpty?: boolean;
  engineType?: AgentSummary['engineType'];
  statusText?: string;
  statusTone?: 'ready' | 'warning';
  /** Full-width embed (e.g. home agent hub): no page gutters, hide gateway/quota footer row. */
  variant?: 'default' | 'embedded';
  /** One-time seed into the textarea (e.g. task subitem default prompt). */
  seedText?: string;
  /** 技能广场「使用」：预填技能标签 */
  seedSkillSlug?: string;
  /** User-message text selected for editing and sending again. */
  editDraft?: {
    text: string;
    skill?: SkillMeta;
    version: number;
  } | null;
  onEditDraftApplied?: () => void;
  /** Override default composer placeholder (e.g. site home prompt). */
  placeholder?: string;
  /** Merged onto the outer wrapper (after defaults); use to tune padding, e.g. task subitem bottom inset. */
  className?: string;
  /** 首页 HomeComposer：内联引擎/模型 + 新工具栏布局（默认关闭，其它页面不传） */
  composerLayout?: 'default' | 'home';
  /** 首页工具栏右侧：内联 ChatEngineSelector / ChatModelSelector */
  toolbarInlineSelectors?: ReactNode;
}

// ── Helpers ──────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType.startsWith('video/')) return <Film className={className} />;
  if (mimeType.startsWith('audio/')) return <Music className={className} />;
  if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') return <FileText className={className} />;
  if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive') || mimeType.includes('tar') || mimeType.includes('rar') || mimeType.includes('7z')) return <FileArchive className={className} />;
  if (mimeType === 'application/pdf') return <FileText className={className} />;
  return <File className={className} />;
}

/**
 * Read a browser File object as base64 string (without the data URL prefix).
 */
function readFileAsBase64(file: globalThis.File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (!dataUrl || !dataUrl.includes(',')) {
        reject(new Error(`Invalid data URL from FileReader for ${file.name}`));
        return;
      }
      const base64 = dataUrl.split(',')[1];
      if (!base64) {
        reject(new Error(`Empty base64 data for ${file.name}`));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

// ── Component ────────────────────────────────────────────────────

export function ChatInput({
  onSend,
  onStop,
  onQueue,
  disabled = false,
  sending = false,
  isEmpty: _isEmpty = false,
  engineType,
  statusText,
  statusTone = 'warning',
  variant = 'default',
  seedText,
  seedSkillSlug,
  editDraft = null,
  onEditDraftApplied,
  placeholder,
  className,
  composerLayout = 'default',
  toolbarInlineSelectors,
}: ChatInputProps) {
  const { t } = useTranslation('chat');
  const [composerSnapshot, setComposerSnapshot] = useState<MentionComposerSnapshot>({
    plainText: '',
    mentions: [],
    isEmpty: true,
  });
  const [mentionTrigger, setMentionTrigger] = useState<ActiveMentionTrigger | null>(null);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [targetAgentId, setTargetAgentId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const mentionEditorRef = useRef<DingTalkMentionEditorHandle>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const mentionPopoverRef = useRef<HTMLDivElement>(null);
  const workflowPickerRef = useRef<HTMLDivElement>(null);
  const workflowButtonRef = useRef<HTMLButtonElement>(null);
  const skillPickerRef = useRef<HTMLDivElement>(null);
  const skillButtonRef = useRef<HTMLButtonElement>(null);
  const isComposingRef = useRef(false);
  const [workflowPickerOpen, setWorkflowPickerOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [skillPickerMode, setSkillPickerMode] = useState<'inline' | 'toolbar'>('inline');
  const gatewayStatus = useGatewayStore((s) => s.status);
  const agents = useAgentsStore((s) => s.agents);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const workflowCardStates = useChatStore((s) => s.workflowCardStates);
  const pendingProjectId = useChatStore((s) => s.pendingProjectId);
  const workspaces = useSessionCatalogStore((s) => s.workspaces);
  const sessionWorkspaceByKey = useSessionCatalogStore((s) => s.sessionWorkspaceByKey);
  const currentAgentName = useMemo(() => {
    const projectId = getProjectIdFromProjectAgentId(currentAgentId ?? '')
      ?? sessionWorkspaceByKey[currentSessionKey]
      ?? pendingProjectId
      ?? null;
    const projectName = projectId
      ? workspaces.find((workspace) => workspace.id === projectId)?.name
      : null;
    return resolveAgentById(agents ?? [], currentAgentId, projectName)?.name ?? currentAgentId;
  }, [agents, currentAgentId, currentSessionKey, pendingProjectId, sessionWorkspaceByKey, workspaces]);
  const mentionableAgents = useMemo(
    () => (agents ?? []).filter((agent) => agent.id !== currentAgentId),
    [agents, currentAgentId],
  );
  const selectedTarget = useMemo(
    () => (agents ?? []).find((agent) => agent.id === targetAgentId) ?? null,
    [agents, targetAgentId],
  );
  // Agent 工具栏图标暂隐藏；恢复时改回 mentionableAgents.length > 0
  const showAgentPicker = false;
  const {
    open: dingTalkMentionOpen,
    trigger: dingTalkTrigger,
    items: dingTalkItems,
    recent: dingTalkRecent,
    loading: dingTalkLoading,
    loadingMore: dingTalkLoadingMore,
    hasMore: dingTalkHasMore,
    loadMore: loadMoreDingTalkMentions,
    error: dingTalkError,
    needsAuth: dingTalkNeedsAuth,
    needsInstall: dingTalkNeedsInstall,
    activeIndex: dingTalkActiveIndex,
    setActiveIndex: setDingTalkActiveIndex,
    moveActive: moveDingTalkActive,
    close: closeDingTalkMention,
    login: loginDingTalkMention,
    loggingIn: dingTalkLoggingIn,
    install: installDingTalkMention,
    installing: dingTalkInstalling,
  } = useDingTalkMention(mentionTrigger);
  const composerPlaceholder = disabled && engineType === 'openclaw'
    ? t('composer.gatewayDisconnectedPlaceholder')
    : placeholder?.trim() || t('composer.messagePlaceholder', { agent: currentAgentName });
  // Focus editor on mount (avoids Windows focus loss after session delete + native dialog)
  useEffect(() => {
    if (!disabled) {
      mentionEditorRef.current?.focus();
    }
  }, [disabled]);

  const applyEditDraftText = useCallback((rawText: string, skill?: SkillMeta) => {
    const text = rawText.trim();
    if (!text && !skill) return;
    mentionEditorRef.current?.setPlainText(text);
    if (skill) {
      mentionEditorRef.current?.insertSkill(skill.slug, skill.title);
    }
    mentionEditorRef.current?.focus();
    setAttachments([]);
    setTargetAgentId(null);
    setPickerOpen(false);
    setWorkflowPickerOpen(false);
    setSkillPickerOpen(false);
    setMentionTrigger(null);
    closeDingTalkMention();
  }, [closeDingTalkMention]);

  useEffect(() => {
    if (!editDraft) return;
    applyEditDraftText(editDraft.text, editDraft.skill);
    onEditDraftApplied?.();
  }, [applyEditDraftText, editDraft, onEditDraftApplied]);

  useEffect(() => {
    const handleEditDraftEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: unknown; skill?: unknown }>).detail;
      if (typeof detail?.text !== 'string') return;
      const skill = detail.skill;
      const skillMeta =
        skill
        && typeof skill === 'object'
        && typeof (skill as SkillMeta).slug === 'string'
        && typeof (skill as SkillMeta).title === 'string'
          ? (skill as SkillMeta)
          : undefined;
      applyEditDraftText(detail.text, skillMeta);
    };

    window.addEventListener(CHAT_EDIT_DRAFT_EVENT, handleEditDraftEvent);
    return () => {
      window.removeEventListener(CHAT_EDIT_DRAFT_EVENT, handleEditDraftEvent);
    };
  }, [applyEditDraftText]);

  useEffect(() => {
    if (!targetAgentId) return;
    if (targetAgentId === currentAgentId) {
      setTargetAgentId(null);
      setPickerOpen(false);
      return;
    }
    if (!(agents ?? []).some((agent) => agent.id === targetAgentId)) {
      setTargetAgentId(null);
      setPickerOpen(false);
    }
  }, [agents, currentAgentId, targetAgentId]);

  useEffect(() => {
    if (!pickerOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [pickerOpen]);

  useEffect(() => {
    if (!workflowPickerOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !workflowPickerRef.current?.contains(target) &&
        !workflowButtonRef.current?.contains(target)
      ) {
        setWorkflowPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [workflowPickerOpen]);

  useEffect(() => {
    if (!skillPickerOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (skillPickerRef.current?.contains(target)) return;
      if (skillButtonRef.current?.contains(target)) return;
      if (skillPickerMode === 'inline' && mentionPopoverRef.current?.contains(target)) return;

      if (skillPickerMode === 'inline') {
        mentionEditorRef.current?.consumeSkillInlineTrigger();
      }
      setSkillPickerOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [skillPickerMode, skillPickerOpen]);

  // 暂时关闭 `*` 触发技能列表；恢复时取消下方注释
  // useEffect(() => {
  //   if (composerSnapshot.skill) return;
  //
  //   const hasTrigger = hasSkillInlineTrigger(composerSnapshot.plainText);
  //
  //   // toolbar 模式由按钮控制，不受 editor 内 `*` 影响
  //   if (skillPickerOpen && skillPickerMode === 'toolbar') return;
  //
  //   if (hasTrigger) {
  //     if (!skillPickerOpen || skillPickerMode !== 'inline') {
  //       setWorkflowPickerOpen(false);
  //       setSkillPickerMode('inline');
  //       setSkillPickerOpen(true);
  //     }
  //     return;
  //   }
  //
  //   if (skillPickerOpen && skillPickerMode === 'inline') {
  //     setSkillPickerOpen(false);
  //   }
  // }, [composerSnapshot.plainText, composerSnapshot.skill, skillPickerMode, skillPickerOpen]);

  const skillPickerInlineQuery = useMemo(
    () => (skillPickerMode === 'inline' ? extractSkillInlineQuery(composerSnapshot.plainText) : ''),
    [composerSnapshot.plainText, skillPickerMode],
  );

  const handleSkillSelect = useCallback(({ slug, title }: { slug: string; title: string }) => {
    setSkillPickerOpen(false);
    if (skillPickerMode === 'inline') {
      mentionEditorRef.current?.consumeSkillInlineTrigger(skillPickerInlineQuery);
    }
    mentionEditorRef.current?.insertSkill(slug, title);
    mentionEditorRef.current?.focus();
  }, [skillPickerInlineQuery, skillPickerMode]);

  const toggleSkillPickerToolbar = useCallback(() => {
    setWorkflowPickerOpen(false);
    setSkillPickerOpen((open) => {
      if (!open) {
        setSkillPickerMode('toolbar');
      }
      return !open;
    });
  }, []);

  const applyDingTalkMention = useCallback((item: MentionSearchItem) => {
    if (!dingTalkTrigger) return;
    const mention = mentionSearchItemToMention(item);
    logDingTalkMentionClient('[dingtalk-mention] chat-input: select item', {
      itemType: item.type,
      itemTitle: item.title,
      itemHasId: Boolean(item.id),
      itemHasCorpId: Boolean(item.corpId),
      mentionType: mention.type,
      mentionDisplayName: mention.displayName,
      mentionHasUserId: Boolean(mention.userId),
      mentionHasOpenConversationId: Boolean(mention.openConversationId),
      triggerQuery: dingTalkTrigger.query,
      triggerStartOffset: dingTalkTrigger.startOffset,
      triggerEndOffset: dingTalkTrigger.endOffset,
    });
    mentionEditorRef.current?.insertMention(mention, dingTalkTrigger);
    closeDingTalkMention();
    setMentionTrigger(null);
  }, [closeDingTalkMention, dingTalkTrigger]);

  // ── File staging via native dialog ─────────────────────────────

  const pickFiles = useCallback(async () => {
    try {
      const result = await invokeIpc('dialog:open', {
        properties: ['openFile', 'multiSelections'],
      }) as { canceled: boolean; filePaths?: string[] };
      if (result.canceled || !result.filePaths?.length) return;

      // Add placeholder entries immediately
      const tempIds: string[] = [];
      for (const filePath of result.filePaths) {
        const tempId = crypto.randomUUID();
        tempIds.push(tempId);
        // Handle both Unix (/) and Windows (\) path separators
        const fileName = filePath.split(/[\\/]/).pop() || 'file';
        setAttachments(prev => [...prev, {
          id: tempId,
          fileName,
          mimeType: '',
          fileSize: 0,
          stagedPath: '',
          preview: null,
          status: 'staging' as const,
        }]);
      }

      // Stage all files via IPC
      const staged = await hostApiFetch<Array<{
        id: string;
        fileName: string;
        mimeType: string;
        fileSize: number;
        stagedPath: string;
        preview: string | null;
      }>>('/api/files/stage-paths', {
        method: 'POST',
        body: JSON.stringify({ filePaths: result.filePaths }),
      });

      // Update each placeholder with real data
      setAttachments(prev => {
        let updated = [...prev];
        for (let i = 0; i < tempIds.length; i++) {
          const tempId = tempIds[i];
          const data = staged[i];
          if (data) {
            updated = updated.map(a =>
              a.id === tempId
                ? { ...data, status: 'ready' as const }
                : a,
            );
          } else {
            console.warn(`[pickFiles] No staged data for tempId=${tempId} at index ${i}`);
            updated = updated.map(a =>
              a.id === tempId
                ? { ...a, status: 'error' as const, error: 'Staging failed' }
                : a,
            );
          }
        }
        return updated;
      });
    } catch (err) {
      console.error('[pickFiles] Failed to stage files:', err);
      // Mark any stuck 'staging' attachments as 'error' so the user can remove them
      // and the send button isn't permanently blocked
      setAttachments(prev => prev.map(a =>
        a.status === 'staging'
          ? { ...a, status: 'error' as const, error: String(err) }
          : a,
      ));
    }
  }, []);

  // ── Stage browser File objects (paste / drag-drop) ─────────────

  const stageBufferFiles = useCallback(async (files: globalThis.File[]) => {
    for (const file of files) {
      const tempId = crypto.randomUUID();
      const mimeType = file.type || inferMimeTypeFromPath(file.name);
      setAttachments(prev => [...prev, {
        id: tempId,
        fileName: file.name,
        mimeType,
        fileSize: file.size,
        stagedPath: '',
        preview: null,
        status: 'staging' as const,
      }]);

      try {
        const base64 = await readFileAsBase64(file);
        const staged = await hostApiFetch<{
          id: string;
          fileName: string;
          mimeType: string;
          fileSize: number;
          stagedPath: string;
          preview: string | null;
        }>('/api/files/stage-buffer', {
          method: 'POST',
          body: JSON.stringify({
            base64,
            fileName: file.name,
            mimeType,
          }),
        });
        setAttachments(prev => prev.map(a =>
          a.id === tempId ? { ...staged, status: 'ready' as const } : a,
        ));
      } catch (err) {
        console.error(`[stageBuffer] Error staging ${file.name}:`, err);
        setAttachments(prev => prev.map(a =>
          a.id === tempId
            ? { ...a, status: 'error' as const, error: String(err) }
            : a,
        ));
      }
    }
  }, []);

  // ── Attachment management ──────────────────────────────────────

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  const allReady = attachments.length === 0 || attachments.every(a => a.status === 'ready');
  const hasFailedAttachments = attachments.some((a) => a.status === 'error');
  const canSend = ((!composerSnapshot.isEmpty && composerSnapshot.plainText.trim().length > 0)
    || composerSnapshot.skill != null
    || attachments.length > 0)
    && allReady
    && !disabled;
  const canStop = sending && !disabled && !!onStop;

  const handleSend = useCallback(() => {
    const readyAttachments = attachments.filter(a => a.status === 'ready');
    // Read DOM snapshot directly — React state can lag one frame behind the editor.
    const snapshot = mentionEditorRef.current?.getSnapshot() ?? composerSnapshot;
    const skillMetaToSend = snapshot.skill
      ?? composerSnapshot.skill
      ?? mentionEditorRef.current?.readSkillMeta();
    const textToSend = snapshot.plainText.trim();
    const canSendNow = (textToSend.length > 0 || skillMetaToSend != null || readyAttachments.length > 0)
      && allReady
      && !disabled;
    if (!canSendNow) return;
    const attachmentsToSend = readyAttachments.length > 0 ? readyAttachments : undefined;
    const mentionsToSend = snapshot.mentions.length > 0 ? snapshot.mentions : undefined;
    const workflowIdToSend = snapshot.workflowId;
    const workflowSourceToSend = snapshot.workflowSource ?? null;
    const workflowNameToSend = snapshot.workflowName ?? null;
    console.info('[dingtalk-mention] chat-input: send snapshot', {
      textLength: textToSend.length,
      mentions: snapshot.mentions.map((mention) => ({
        type: mention.type,
        displayName: mention.displayName,
        hasUserId: Boolean(mention.userId),
        hasOpenConversationId: Boolean(mention.openConversationId),
        hasCorpId: Boolean(mention.corpId),
      })),
      attachmentCount: readyAttachments.length,
      hasWorkflowId: Boolean(workflowIdToSend),
      hasSkill: Boolean(skillMetaToSend),
      queued: Boolean(sending && onQueue && !workflowIdToSend),
    });
    logDingTalkMentionClient('[dingtalk-mention] chat-input: send snapshot', {
      textLength: textToSend.length,
      mentionCount: snapshot.mentions.length,
      mentions: snapshot.mentions.map((mention) => ({
        type: mention.type,
        displayName: mention.displayName,
        hasUserId: Boolean(mention.userId),
        hasOpenConversationId: Boolean(mention.openConversationId),
        hasCorpId: Boolean(mention.corpId),
      })),
      targetAgentId: targetAgentId ?? null,
      attachmentCount: readyAttachments.length,
      hasWorkflowId: Boolean(workflowIdToSend),
      hasSkill: Boolean(skillMetaToSend),
      skillSlug: skillMetaToSend?.slug ?? null,
      queued: Boolean(sending && onQueue && !workflowIdToSend),
    });
    mentionEditorRef.current?.clear();
    setAttachments([]);
    setMentionTrigger(null);
    // When AI is responding and queue callback is available, add to queue instead of sending directly
    // but only if no workflow is selected (workflow creation flow needs direct send)
    if (sending && onQueue && !workflowIdToSend) {
      onQueue(textToSend, attachmentsToSend, targetAgentId, mentionsToSend, workflowIdToSend, skillMetaToSend);
    } else {
      onSend(textToSend, attachmentsToSend, targetAgentId, mentionsToSend, workflowIdToSend, workflowSourceToSend, workflowNameToSend, skillMetaToSend);
    }
    setTargetAgentId(null);
    setPickerOpen(false);
    setWorkflowPickerOpen(false);
    setSkillPickerOpen(false);
    closeDingTalkMention();
  }, [allReady, attachments, closeDingTalkMention, composerSnapshot, disabled, onQueue, onSend, sending, targetAgentId]);

  const handleStop = useCallback(() => {
    if (!canStop) return;
    onStop?.();
  }, [canStop, onStop]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (dingTalkMentionOpen && dingTalkItems.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          moveDingTalkActive(1);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          moveDingTalkActive(-1);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          closeDingTalkMention();
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          const nativeEvent = e.nativeEvent as KeyboardEvent;
          if (!isComposingRef.current && !nativeEvent.isComposing && nativeEvent.keyCode !== 229) {
            e.preventDefault();
            const selected = dingTalkItems[dingTalkActiveIndex];
            if (selected) applyDingTalkMention(selected);
            return;
          }
        }
      }

      if (e.key === 'Escape' && skillPickerOpen) {
        e.preventDefault();
        if (skillPickerMode === 'inline') {
          mentionEditorRef.current?.consumeSkillInlineTrigger();
        }
        setSkillPickerOpen(false);
        return;
      }

      if (e.key === 'Backspace' && composerSnapshot.isEmpty && targetAgentId) {
        setTargetAgentId(null);
        return;
      }
      // Trigger workflow picker when typing /
      const hasWorkflowInEditor = !!composerSnapshot.workflowId;
      if (e.key === '/' && !workflowPickerOpen && !hasWorkflowInEditor) {
        const nativeEvent = e.nativeEvent as KeyboardEvent;
        if (!isComposingRef.current && !nativeEvent.isComposing && nativeEvent.keyCode !== 229) {
          // Close mention popover if open
          if (dingTalkMentionOpen) {
            closeDingTalkMention();
            setMentionTrigger(null);
          }
          setSkillPickerOpen(false);
          setWorkflowPickerOpen(true);
        }
      }

      // 暂时关闭 `*` 触发技能列表；恢复时取消下方注释
      // const hasSkillInEditor = !!composerSnapshot.skill;
      // if (e.key === '*' && !hasSkillInEditor) {
      //   const nativeEvent = e.nativeEvent as KeyboardEvent;
      //   if (!isComposingRef.current && !nativeEvent.isComposing && nativeEvent.keyCode !== 229) {
      //     if (dingTalkMentionOpen) {
      //       closeDingTalkMention();
      //       setMentionTrigger(null);
      //     }
      //     setWorkflowPickerOpen(false);
      //     // 打开浮层由 plainText 同步 effect 在 `*` 写入 editor 后处理
      //   }
      // }

      if (e.key === 'Enter' && !e.shiftKey && skillPickerOpen) {
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        const nativeEvent = e.nativeEvent as KeyboardEvent;
        if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
          return;
        }
        e.preventDefault();
        handleSend();
      }
    },
    [
      applyDingTalkMention,
      closeDingTalkMention,
      dingTalkActiveIndex,
      dingTalkItems,
      dingTalkMentionOpen,
      composerSnapshot.isEmpty,
      composerSnapshot.skill,
      composerSnapshot.workflowId,
      handleSend,
      moveDingTalkActive,
      skillPickerMode,
      skillPickerOpen,
      targetAgentId,
      workflowPickerOpen,
    ],
  );

  // Handle paste (Ctrl/Cmd+V with files)
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const pastedFiles: globalThis.File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) pastedFiles.push(file);
        }
      }
      if (pastedFiles.length === 0) return;

      const pastedText = e.clipboardData.getData('text/plain');
      e.preventDefault();
      void stageBufferFiles(pastedFiles);
      if (pastedText.trim()) {
        mentionEditorRef.current?.insertPlainText(pastedText);
      }
    },
    [stageBufferFiles],
  );

  // Handle drag & drop
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (e.dataTransfer?.files?.length) {
        stageBufferFiles(Array.from(e.dataTransfer.files));
      }
    },
    [stageBufferFiles],
  );

  const isEmbedded = variant === 'embedded';
  const isHomeComposer = composerLayout === 'home';

  const handleOpenDingTalkMention = () => {
    mentionEditorRef.current?.openMentionPicker();
  };

  const homeToolbarIconBtn = cn(
    'h-[30px] w-[30px] rounded-[20px] p-0 text-muted-foreground/75',
    'hover:bg-black/5 hover:text-foreground dark:hover:bg-white/[0.06]',
  );

  return (
    <div
      className={cn(
        'w-full transition-all duration-300',
        isEmbedded
          ? cn('px-0 pb-0 pt-0', stoChatShellHomeClass, className)
          : cn('w-full pb-0 pt-2', className),
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="w-full">
        {/* 单壳：附件缩略图与输入区同在一个圆角边框内（与 memory-center-web 助手输入一致） */}
        <div
          className={cn(
            isHomeComposer
              ? cn(
                  chatComposerHomeShellClass,
                  dragOver ? chatComposerHomeShellDragOverClass : chatComposerHomeShellIdleClass,
                )
              : cn(
                  // sto-design: Grey-4 默认描边；Brand-3 悬停边、Brand-5/6 聚焦与拖拽（与 hub 顶栏 hover:border-[#FFC17A] 一致）
                  'relative overflow-visible rounded-2xl border bg-white transition-[box-shadow,border-color,ring-width,ring-color] duration-200 dark:bg-[#131a24]',
                  'border-[#E5E6EB] shadow-[0_4px_14px_rgba(29,33,41,0.05)] ring-1 ring-transparent dark:border-border dark:shadow-[0_4px_14px_rgba(0,0,0,0.22)]',
                  dragOver
                    ? 'border-[#FFC17A] ring-2 ring-[#FFC17A]/35 dark:border-[#FFC17A] dark:ring-[#FFC17A]/30'
                    : [
                        'hover:border-[#FFC17A] hover:shadow-[0_4px_20px_rgba(255,183,140,0.14)]',
                        'dark:hover:border-[#FFC17A]/90 dark:hover:shadow-[0_4px_20px_rgba(255,183,140,0.1)]',
                        'focus-within:border-[#FF8D2A] focus-within:ring-2 focus-within:ring-[#FF6F00]/22',
                        'focus-within:shadow-[0_0_0_1px_rgba(255,141,42,0.4),0_4px_20px_rgba(255,111,0,0.1)]',
                        'dark:focus-within:border-[#FF8D2A] dark:focus-within:ring-[#FF6F00]/28',
                        'dark:focus-within:shadow-[0_0_0_1px_rgba(255,141,42,0.28),0_4px_24px_rgba(255,111,0,0.14)]',
                      ],
                ),
          )}
        >
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1">
              {attachments.map((att) => (
                <AttachmentPreview
                  key={att.id}
                  attachment={att}
                  onRemove={() => removeAttachment(att.id)}
                />
              ))}
            </div>
          )}

          {selectedTarget && (
            <div
              className={cn(
                'px-4 pb-1',
                attachments.length > 0 ? 'pt-2' : 'pt-3',
              )}
            >
              <button
                type="button"
                onClick={() => setTargetAgentId(null)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-primary/6 px-3 py-1 text-[13px] font-medium text-foreground transition-colors hover:bg-primary/10"
                title={t('composer.clearTarget')}
              >
                <span>{t('composer.targetChip', { agent: selectedTarget.name })}</span>
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          )}



          <div className={cn(
            'px-4',
            isHomeComposer
              ? cn(
                  // flex-1 吸收 min-h-[120px] 剩余高度，避免底栏下方出现额外空白（底栏 pb-3 ≈ 12px）
                  'flex min-h-0 flex-1 flex-col',
                  attachments.length > 0 ? 'pt-1' : 'pt-3',
                )
              : cn(attachments.length > 0 ? 'pt-1.5' : 'pt-2.5'),
          )}>
            <div ref={mentionPopoverRef} className="relative flex-1 overflow-visible">
              <DingTalkMentionPopover
                open={dingTalkMentionOpen}
                items={dingTalkItems}
                query={mentionTrigger?.query ?? ''}
                recent={dingTalkRecent}
                loading={dingTalkLoading}
                loadingMore={dingTalkLoadingMore}
                hasMore={dingTalkHasMore}
                loggingIn={dingTalkLoggingIn}
                installing={dingTalkInstalling}
                error={dingTalkError}
                needsAuth={dingTalkNeedsAuth}
                needsInstall={dingTalkNeedsInstall}
                activeIndex={dingTalkActiveIndex}
                onHoverIndex={setDingTalkActiveIndex}
                onSelect={applyDingTalkMention}
                onLogin={loginDingTalkMention}
                onInstall={installDingTalkMention}
                onLoadMore={loadMoreDingTalkMentions}
              />
              <DingTalkMentionEditor
                ref={mentionEditorRef}
                placeholder={composerPlaceholder}
                disabled={disabled}
                seedText={seedText}
                seedSkillSlug={seedSkillSlug}
                onSnapshotChange={setComposerSnapshot}
                onTriggerChange={setMentionTrigger}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onCompositionStart={() => {
                  isComposingRef.current = true;
                }}
                onCompositionEnd={() => {
                  isComposingRef.current = false;
                }}
              />
              <SkillPicker
                ref={skillPickerRef}
                open={skillPickerOpen}
                mode={skillPickerMode}
                query={skillPickerInlineQuery}
                onSelect={handleSkillSelect}
                onClose={() => {
                  if (skillPickerMode === 'inline') {
                    mentionEditorRef.current?.consumeSkillInlineTrigger();
                  }
                  setSkillPickerOpen(false);
                }}
              />
            </div>
          </div>

          {isHomeComposer ? (
            <div className="relative flex shrink-0 items-center justify-between gap-2 px-4 pb-3 pt-1">
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="ghost"
                  type="button"
                  className={homeToolbarIconBtn}
                  onClick={pickFiles}
                  disabled={disabled}
                  title={t('composer.attachFiles')}
                >
                  <Paperclip className="h-4 w-4" aria-hidden />
                </Button>

                <Button
                  variant="ghost"
                  type="button"
                  className={homeToolbarIconBtn}
                  onClick={handleOpenDingTalkMention}
                  disabled={disabled}
                  title={t('composer.dingTalkMention')}
                >
                  <AtSign className="h-4 w-4" aria-hidden />
                </Button>

                <Button
                  ref={skillButtonRef}
                  variant="ghost"
                  type="button"
                  className={cn(
                    homeToolbarIconBtn,
                    skillPickerOpen && skillPickerMode === 'toolbar' && 'bg-primary/10 text-primary hover:bg-primary/12',
                  )}
                  onClick={toggleSkillPickerToolbar}
                  disabled={disabled}
                  title={t('composer.pickSkill')}
                >
                  <Wrench className="h-4 w-4" aria-hidden />
                </Button>

                {showAgentPicker ? (
                  <div ref={pickerRef} className="relative shrink-0">
                    <Button
                      variant="ghost"
                      type="button"
                      className={cn(
                        homeToolbarIconBtn,
                        (pickerOpen || selectedTarget) && 'bg-primary/10 text-primary hover:bg-primary/12',
                      )}
                      onClick={() => setPickerOpen((open) => !open)}
                      disabled={disabled}
                      title={t('composer.pickAgent')}
                    >
                      {/* 临时图标，等用户提供 SVG 替换 */}
                      <Bot className="h-4 w-4" aria-hidden />
                    </Button>
                    {pickerOpen ? (
                      <div className="absolute left-0 bottom-full z-50 mb-2 w-72 overflow-hidden rounded-2xl border border-glass-border glass p-1.5">
                        <div className="px-3 py-2 text-[11px] font-medium text-muted-foreground/80">
                          {t('composer.agentPickerTitle', { currentAgent: currentAgentName })}
                        </div>
                        <div className="max-h-64 overflow-y-auto">
                          {mentionableAgents.map((agent) => (
                            <AgentPickerItem
                              key={agent.id}
                              agent={agent}
                              selected={agent.id === targetAgentId}
                              onSelect={() => {
                                setTargetAgentId(agent.id);
                                setPickerOpen(false);
                                mentionEditorRef.current?.focus();
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div ref={workflowPickerRef} className="relative shrink-0">
                  <Button
                    ref={workflowButtonRef}
                    variant="ghost"
                    type="button"
                    className={cn(
                      homeToolbarIconBtn,
                      workflowPickerOpen && 'bg-primary/10 text-primary hover:bg-primary/12',
                    )}
                    onClick={() => {
                      setSkillPickerOpen(false);
                      setWorkflowPickerOpen((open) => !open);
                    }}
                    disabled={disabled}
                    title={t('composer.pickWorkflow')}
                  >
                    {/* 临时图标，等用户提供 SVG 替换 */}
                    <Workflow className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </div>

              <div className="flex min-w-0 items-center gap-2">
                {toolbarInlineSelectors}
                {/* 语音输入暂未接入，先隐藏 Mic 按钮；恢复时还原 ghost Button + Mic 图标 */}
                {sending && canSend ? (
                  <Button
                    onClick={handleSend}
                    size="icon"
                    className="h-[30px] w-[30px] shrink-0 rounded-[16px] border border-primary/80 bg-primary text-primary-foreground shadow-[0_6px_16px_rgba(255,111,0,0.22)] hover:bg-primary/90"
                    variant="ghost"
                    title={t('composer.send')}
                  >
                    <ArrowUp className="h-4 w-4" strokeWidth={2.1} aria-hidden />
                  </Button>
                ) : (
                  <Button
                    onClick={sending ? handleStop : handleSend}
                    disabled={sending ? !canStop : !canSend}
                    size="icon"
                    className={cn(
                      'h-[30px] w-[30px] shrink-0 rounded-[16px] border transition-all',
                      sending
                        ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800 dark:border-white/80 dark:bg-white/80 dark:text-slate-900 dark:hover:bg-white/90'
                        : canSend
                          ? 'border-primary/80 bg-primary text-primary-foreground shadow-[0_6px_16px_rgba(255,111,0,0.22)] hover:bg-primary/90'
                          : 'border-black/8 bg-black/5 text-muted-foreground/55 dark:border-white/10 dark:bg-white/[0.06]',
                    )}
                    variant="ghost"
                    title={sending ? t('composer.stop') : t('composer.send')}
                  >
                    {sending ? (
                      <Square className="h-3.5 w-3.5" fill="currentColor" aria-hidden />
                    ) : (
                      <ArrowUp className="h-4 w-4" strokeWidth={2.1} aria-hidden />
                    )}
                  </Button>
                )}
              </div>

              <WorkflowPicker
                ref={workflowPickerRef}
                open={workflowPickerOpen}
                anchorRef={workflowButtonRef}
                onClose={() => setWorkflowPickerOpen(false)}
                onSelect={async (id, name) => {
                  setWorkflowPickerOpen(false);
                  const { useChatStore } = await import('@/stores/chat');
                  useChatStore.getState().clearPendingWorkflow();
                  mentionEditorRef.current?.insertWorkflow(id, name, 'mine');
                  mentionEditorRef.current?.focus();
                }}
              />
            </div>
          ) : (
          <div className="flex items-center justify-between gap-3 px-4 pb-1.5 pt-0.5">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                type="button"
                className="h-8 w-8 rounded-full p-0 text-muted-foreground/75 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/[0.06]"
                onClick={pickFiles}
                disabled={disabled}
                title={t('composer.attachFiles')}
              >
                <Paperclip className="h-3.5 w-3.5" />
              </Button>

              {showAgentPicker && (
                <div ref={pickerRef} className="relative shrink-0">
                  <Button
                    variant="ghost"
                    type="button"
                    className={cn(
                      'h-8 w-8 rounded-full p-0 text-muted-foreground/75 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/[0.06]',
                      (pickerOpen || selectedTarget) && 'bg-primary/10 text-primary hover:bg-primary/12'
                    )}
                    onClick={() => setPickerOpen((open) => !open)}
                    disabled={disabled}
                    title={t('composer.pickAgent')}
                  >
                    <AtSign className="h-3.5 w-3.5" />
                  </Button>
                  {pickerOpen && (
                    <div className="absolute left-0 bottom-full z-50 mb-2 w-72 overflow-hidden rounded-2xl border border-glass-border glass p-1.5">
                      <div className="px-3 py-2 text-[11px] font-medium text-muted-foreground/80">
                        {t('composer.agentPickerTitle', { currentAgent: currentAgentName })}
                      </div>
                      <div className="max-h-64 overflow-y-auto">
                        {mentionableAgents.map((agent) => (
                          <AgentPickerItem
                            key={agent.id}
                            agent={agent}
                            selected={agent.id === targetAgentId}
                            onSelect={() => {
                              setTargetAgentId(agent.id);
                              setPickerOpen(false);
                              mentionEditorRef.current?.focus();
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <Button
                ref={skillButtonRef}
                variant="ghost"
                type="button"
                className={cn(
                  'h-8 w-8 rounded-full p-0 text-muted-foreground/75 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/[0.06]',
                  skillPickerOpen && skillPickerMode === 'toolbar' && 'bg-primary/10 text-primary hover:bg-primary/12',
                )}
                onClick={toggleSkillPickerToolbar}
                disabled={disabled}
                title={t('composer.pickSkill')}
              >
                <Wrench className="h-3.5 w-3.5" />
              </Button>

              {/* Workflow picker button */}
              <div ref={workflowPickerRef} className="relative shrink-0">
                <Button
                  ref={workflowButtonRef}
                  variant="ghost"
                  type="button"
                  className={cn(
                    'h-8  rounded-full p-4 text-muted-foreground/75 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/[0.06]',
                    workflowPickerOpen && 'bg-primary/10 text-primary hover:bg-primary/12'
                  )}
                  onClick={() => {
                    setSkillPickerOpen(false);
                    setWorkflowPickerOpen((open) => !open);
                  }}
                  disabled={disabled}
                  title={t('composer.pickWorkflow')}
                >
                  <span className="text-[13px] font-medium">{t('composer.pickWorkflow')}</span>
                </Button>
              </div>
            </div>

            {/* Workflow picker */}
            <WorkflowPicker
              ref={workflowPickerRef}
              open={workflowPickerOpen}
              anchorRef={workflowButtonRef}
              onClose={() => setWorkflowPickerOpen(false)}
              onSelect={async (id, name) => {
                setWorkflowPickerOpen(false);
                const { useChatStore } = await import('@/stores/chat');
                useChatStore.getState().clearPendingWorkflow();
                mentionEditorRef.current?.insertWorkflow(id, name, 'mine');
                mentionEditorRef.current?.focus();
              }}
            />

            {/* When sending: show Send (to queue) if there's input, otherwise show Stop */}
            {sending && canSend ? (
              <Button
                onClick={handleSend}
                size="icon"
                className={cn(
                  'h-9 w-9 shrink-0 rounded-full border transition-all',
                  'border-primary/80 bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_6px_16px_rgba(255,111,0,0.22)]',
                )}
                variant="ghost"
                title={t('composer.send')}
              >
                <SendHorizontal className="h-4 w-4" strokeWidth={2.1} />
              </Button>
            ) : (
              <Button
                onClick={sending ? handleStop : handleSend}
                disabled={sending ? !canStop : !canSend}
                size="icon"
                className={cn(
                  'h-9 w-9 shrink-0 rounded-full border transition-all',
                  sending
                    ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800 dark:border-white/80 dark:bg-white/80 dark:text-slate-900 dark:hover:bg-white/90'
                    : canSend
                      ? 'border-primary/80 bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_6px_16px_rgba(255,111,0,0.22)]'
                      : 'border-black/8 bg-black/5 text-muted-foreground/55 dark:border-white/10 dark:bg-white/[0.06]'
                )}
                variant="ghost"
                title={sending ? t('composer.stop') : t('composer.send')}
              >
                {sending ? (
                  <Square className="h-3.5 w-3.5" fill="currentColor" />
                ) : (
                  <SendHorizontal className="h-4 w-4" strokeWidth={2.1} />
                )}
              </Button>
            )}
          </div>
          )}
        </div>
        <WorkflowComposerProgress sessionKey={currentSessionKey} states={workflowCardStates} />
        {!isEmbedded ? (
          <div className="mt-2.5 flex items-center justify-between gap-2 px-4 text-[11px] text-muted-foreground/60">
            {engineType === 'openclaw' ? (
              <div className="flex items-center gap-1.5">
                <div
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    statusTone === 'ready' ? 'bg-green-500/80' : 'bg-red-500/80',
                  )}
                />
                <span>
                  {statusText ?? t('composer.gatewayStatus', {
                    state: gatewayStatus.state === 'running'
                      ? t('composer.gatewayConnected')
                      : gatewayStatus.state,
                    port: gatewayStatus.port,
                    pid: gatewayStatus.pid ? `| pid: ${gatewayStatus.pid}` : '',
                  })}
                </span>
              </div>
            ) : engineType === 'claude' ? (
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-green-500/80" />
                <span>{statusText ?? t('composer.claudeReady')}</span>
              </div>
            ) : <div />}
            <div className="flex items-center gap-3">
              {hasFailedAttachments && (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-[11px]"
                  onClick={() => {
                    setAttachments((prev) => prev.filter((att) => att.status !== 'error'));
                    void pickFiles();
                  }}
                >
                  {t('composer.retryFailedAttachments')}
                </Button>
              )}
            </div>
          </div>
        ) : hasFailedAttachments ? (
          <div className="mt-2 flex justify-end px-4">
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-[11px] text-muted-foreground/80"
              onClick={() => {
                setAttachments((prev) => prev.filter((att) => att.status !== 'error'));
                void pickFiles();
              }}
            >
              {t('composer.retryFailedAttachments')}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Attachment Preview ───────────────────────────────────────────

function AttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: FileAttachment;
  onRemove: () => void;
}) {
  const isImage = attachment.mimeType.startsWith('image/') && attachment.preview;

  return (
    <div className="relative group rounded-md overflow-hidden border border-border">
      {isImage ? (
        // Image thumbnail（略小于原 16，删除钮贴右上角内侧）
        <div className="h-12 w-12 shrink-0">
          <img
            src={attachment.preview!}
            alt={attachment.fileName}
            className="h-full w-full object-cover"
          />
        </div>
      ) : (
        // Generic file card
        <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 max-w-[200px]">
          <FileIcon mimeType={attachment.mimeType} className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 overflow-hidden">
            <p className="text-xs font-medium truncate">{attachment.fileName}</p>
            <p className="text-[10px] text-muted-foreground">
              {attachment.fileSize > 0 ? formatFileSize(attachment.fileSize) : '...'}
            </p>
          </div>
        </div>
      )}

      {/* Staging overlay */}
      {attachment.status === 'staging' && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
          <Loader2 className="h-4 w-4 text-white animate-spin" />
        </div>
      )}

      {/* Error overlay */}
      {attachment.status === 'error' && (
        <div className="absolute inset-0 bg-destructive/20 flex items-center justify-center">
          <span className="text-[10px] text-destructive font-medium px-1">Error</span>
        </div>
      )}

      {/* Remove：放在角内侧，flex 居中避免视觉偏移 */}
      <button
        type="button"
        onClick={onRemove}
        className={cn(
          'absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full',
          'bg-destructive text-destructive-foreground shadow-sm ring-2 ring-background',
          'opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100',
        )}
        aria-label="移除附件"
      >
        <X className="h-3 w-3 shrink-0" strokeWidth={2.5} />
      </button>
    </div>
  );
}

function AgentPickerItem({
  agent,
  selected,
  onSelect,
}: {
  agent: AgentSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col items-start rounded-xl px-3 py-2 text-left transition-colors',
        selected ? 'bg-primary/10 text-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5'
      )}
    >
      <span className="text-[14px] font-medium text-foreground">{agent.name}</span>
      <span className="text-[11px] text-muted-foreground">
        {agent.modelDisplay}
      </span>
    </button>
  );
}
