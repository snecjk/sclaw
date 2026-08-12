/**
 * 编辑重发草稿：监听 `CHAT_EDIT_DRAFT_EVENT` + `editDraft` prop，写入 MentionEditor。
 */
import { useCallback, useEffect, type RefObject } from 'react';
import type { DingTalkMentionEditorHandle } from '@/components/dingtalk/DingTalkMentionEditor';
import type { FileAttachment } from '@/components/attachments/types';
import type {
  AttachmentLookupEntry,
  ComposerSegment,
  PersistedComposerSegment,
} from '@/lib/dingtalk-mention-composer';
import type { SkillMeta } from '@/types/skill-meta';
import { stripComposerGatewayPlaceholders } from '@/lib/user-message-display';

/** window 自定义事件名，与 ChatMessage 派发侧保持一致 */
export const CHAT_EDIT_DRAFT_EVENT = 'stoclaw:chat-edit-draft';

/** 草稿中的工作流片段 */
export interface ChatDraftWorkflowMeta {
  id: string;
  name: string;
  source?: string;
}

export type ChatEditDraftAttachment = Partial<FileAttachment> & {
  id: string;
  fileName: string;
  mimeType: string;
  filePath?: string;
};

/** `CHAT_EDIT_DRAFT_EVENT` 的 detail；字段均可选，有则按序写入编辑器 */
export interface ChatEditDraftEventDetail {
  text?: string;
  skill?: SkillMeta;
  workflow?: ChatDraftWorkflowMeta;
  prefixText?: string;
  suffixText?: string;
  segments?: PersistedComposerSegment[];
  attachments?: ChatEditDraftAttachment[];
}

/** editDraft prop 与事件共用的接线选项 */
export interface UseInputComposerEditDraftOptions {
  mentionEditorRef: RefObject<DingTalkMentionEditorHandle | null>;
  editDraft?: {
    text: string;
    skill?: SkillMeta;
    segments?: PersistedComposerSegment[];
    attachments?: ChatEditDraftAttachment[];
    version: number;
  } | null;
  onEditDraftApplied?: () => void;
  onAfterApply?: () => void;
  onApplyAttachments?: (attachments: FileAttachment[]) => void;
}

function sanitizeEditPlainText(text: string): string {
  return stripComposerGatewayPlaceholders(text)
    .replace(/\s+/g, ' ')
    .trim();
}

function takePreferredAttachment(
  seg: Extract<PersistedComposerSegment, { type: 'file' }>,
  preferred: ChatEditDraftAttachment[] | undefined,
  used: Set<number>,
): ChatEditDraftAttachment | undefined {
  if (!preferred?.length) return undefined;
  const byName = preferred.findIndex((item, index) => (
    !used.has(index) && item.fileName === seg.fileName
  ));
  if (byName >= 0) {
    used.add(byName);
    return preferred[byName];
  }
  const byOrder = preferred.findIndex((_, index) => !used.has(index));
  if (byOrder >= 0) {
    used.add(byOrder);
    return preferred[byOrder];
  }
  return undefined;
}

/**
 * 把持久化气泡 segments 转为可编辑的 composer segments。
 * 文件 segment 的 `attachmentId` 必须与注册表附件 `id` 对齐——
 * 否则重建/发送会跳过文件（出现「根据  和  生成…」空缺）。
 */
export function persistedSegmentsToComposer(
  segments: PersistedComposerSegment[],
  preferredAttachments?: ChatEditDraftAttachment[],
): {
  segments: ComposerSegment[];
  attachments: FileAttachment[];
  attachmentsById: Record<string, AttachmentLookupEntry>;
} {
  const attachments: FileAttachment[] = [];
  const attachmentsById: Record<string, AttachmentLookupEntry> = {};
  const composerSegments: ComposerSegment[] = [];
  const usedPreferred = new Set<number>();

  for (const seg of segments) {
    if (seg.type !== 'file') {
      // 禁止通过脏 text segment 再次插入 stage-6 占位符。
      if (seg.type === 'text') {
        const cleaned = stripComposerGatewayPlaceholders(seg.text);
        if (!cleaned) continue;
        composerSegments.push({ type: 'text', text: cleaned });
        continue;
      }
      composerSegments.push(seg);
      continue;
    }

    const preferred = takePreferredAttachment(seg, preferredAttachments, usedPreferred);
    const id = preferred?.id ?? crypto.randomUUID();
    const stagedPath = preferred?.stagedPath
      ?? preferred?.filePath
      ?? seg.stagedPath
      ?? seg.filePath
      ?? '';
    const att: FileAttachment = {
      id,
      fileName: preferred?.fileName ?? seg.fileName,
      mimeType: preferred?.mimeType ?? seg.mimeType,
      fileSize: preferred?.fileSize ?? seg.fileSize,
      stagedPath,
      preview: preferred?.preview ?? seg.preview,
      status: stagedPath ? 'ready' : 'error',
      error: stagedPath ? undefined : 'File unavailable — please re-attach',
      provenance: preferred?.provenance ?? seg.provenance,
    };
    attachments.push(att);
    attachmentsById[id] = {
      id,
      fileName: att.fileName,
      mimeType: att.mimeType,
      fileSize: att.fileSize,
      status: att.status,
      preview: att.preview,
    };
    composerSegments.push({ type: 'file', attachmentId: id });
  }

  return { segments: composerSegments, attachments, attachmentsById };
}

export function useInputComposerEditDraft({
  mentionEditorRef,
  editDraft = null,
  onEditDraftApplied,
  onAfterApply,
  onApplyAttachments,
}: UseInputComposerEditDraftOptions) {
  const applyEditDraftText = useCallback((detail: ChatEditDraftEventDetail) => {
    const text = sanitizeEditPlainText(detail.text ?? '');
    const prefixText = sanitizeEditPlainText(detail.prefixText ?? '');
    const suffixText = sanitizeEditPlainText(detail.suffixText ?? '');
    const skill = detail.skill;
    const workflow = detail.workflow;
    const hasSegments = Boolean(detail.segments?.length);

    if (!hasSegments && !text && !prefixText && !suffixText && !skill && !workflow) return;

    if (hasSegments && detail.segments) {
      // DOM span 与附件注册表共用同一 ID 空间（preferred 仅补充路径）。
      const converted = persistedSegmentsToComposer(detail.segments, detail.attachments);
      onApplyAttachments?.(converted.attachments);
      mentionEditorRef.current?.setSegments(converted.segments, converted.attachmentsById);
      mentionEditorRef.current?.focus();
      onAfterApply?.();
      return;
    }

    mentionEditorRef.current?.setPlainText('');
    if (prefixText) {
      mentionEditorRef.current?.setPlainText(prefixText);
    }
    if (text) {
      mentionEditorRef.current?.insertPlainText(text);
    }
    if (skill) {
      mentionEditorRef.current?.insertSkill(skill.slug, skill.title, skill.tagOffset ?? 0);
    }
    if (workflow) {
      mentionEditorRef.current?.insertWorkflow(workflow.id, workflow.name, workflow.source);
    }
    if (suffixText) {
      mentionEditorRef.current?.insertPlainText(suffixText);
    }
    mentionEditorRef.current?.focus();
    onAfterApply?.();
  }, [mentionEditorRef, onAfterApply, onApplyAttachments]);

  useEffect(() => {
    if (!editDraft) return;
    applyEditDraftText({
      text: editDraft.text,
      skill: editDraft.skill,
      segments: editDraft.segments,
      attachments: editDraft.attachments,
    });
    onEditDraftApplied?.();
  }, [applyEditDraftText, editDraft, onEditDraftApplied]);

  useEffect(() => {
    const handleEditDraftEvent = (event: Event) => {
      const detail = (event as CustomEvent<{
        text?: unknown;
        skill?: unknown;
        workflow?: unknown;
        prefixText?: unknown;
        suffixText?: unknown;
        segments?: unknown;
        attachments?: unknown;
      }>).detail;
      if (!detail || typeof detail !== 'object') return;
      const skill = detail.skill;
      const skillMeta =
        skill
        && typeof skill === 'object'
        && typeof (skill as SkillMeta).slug === 'string'
        && typeof (skill as SkillMeta).title === 'string'
          ? (skill as SkillMeta)
          : undefined;
      const workflow = detail.workflow;
      const workflowMeta =
        workflow
        && typeof workflow === 'object'
        && typeof (workflow as ChatDraftWorkflowMeta).id === 'string'
        && typeof (workflow as ChatDraftWorkflowMeta).name === 'string'
          ? {
              id: (workflow as ChatDraftWorkflowMeta).id,
              name: (workflow as ChatDraftWorkflowMeta).name,
              source: typeof (workflow as ChatDraftWorkflowMeta).source === 'string'
                ? (workflow as ChatDraftWorkflowMeta).source
                : undefined,
            }
          : undefined;
      applyEditDraftText({
        text: typeof detail.text === 'string' ? detail.text : undefined,
        prefixText: typeof detail.prefixText === 'string' ? detail.prefixText : undefined,
        suffixText: typeof detail.suffixText === 'string' ? detail.suffixText : undefined,
        skill: skillMeta,
        workflow: workflowMeta,
        segments: Array.isArray(detail.segments)
          ? detail.segments as PersistedComposerSegment[]
          : undefined,
        attachments: Array.isArray(detail.attachments)
          ? detail.attachments as ChatEditDraftAttachment[]
          : undefined,
      });
    };

    window.addEventListener(CHAT_EDIT_DRAFT_EVENT, handleEditDraftEvent);
    return () => {
      window.removeEventListener(CHAT_EDIT_DRAFT_EVENT, handleEditDraftEvent);
    };
  }, [applyEditDraftText]);

  return { applyEditDraftText };
}
