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
import {
  stripComposerGatewayPlaceholders,
  stripGatewayMediaAttached,
  stripGatewayTimestampPrefix,
} from '@/lib/user-message-display';
import { stripSkillGatewayPrefix } from '@/lib/skill-transcript-marker';
import { stripPlanGatePromptForDisplay } from '@/lib/app-dev-plan-gate';
import { unescapeLiteralNewlines } from '../../../shared/text-escape';
import { hostApiFetch } from '@/lib/host-api';
import { stageDataCenterSelection } from '@/components/data-center-file-picker/stage-selection';

/** window 自定义事件名，与 ChatMessage 派发侧保持一致 */
export const CHAT_EDIT_DRAFT_EVENT = 'stoclaw:chat-edit-draft';

/** 草稿中的工作流片段 */
export interface ChatDraftWorkflowMeta {
  id: string;
  name: string;
  /** `'mine'` = 实例；`'template'` = 模版（学习中心 / 首页推荐） */
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

function sanitizeEditPlainText(text: string, skill?: SkillMeta): string {
  let cleaned = stripComposerGatewayPlaceholders(text);
  cleaned = stripGatewayMediaAttached(cleaned);
  cleaned = stripGatewayTimestampPrefix(cleaned);
  if (skill?.slug || skill?.title) {
    cleaned = stripSkillGatewayPrefix(
      cleaned,
      '',
      skill.title ?? '',
      skill.slug,
    );
  }
  // 换行策略与 sanitizePersistedTextSegmentForEdit / normalizeUserMessageForDisplay 对齐：
  // 折叠行内空白为单空格、保留换行、3+ 换行压成 2 换行、trim。
  // 消除 chat 冷读编辑降级路径与 task 描述框的行为差（多行文本不再被压成单行）。
  return cleaned
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export { sanitizeEditPlainText };

/** 判断清洗后的正文是否以技能 slug/title 开头（才值得跑 stripSkillGatewayPrefix）。 */
function textLooksLikeSkillGatewayPrefix(
  text: string,
  skill: Pick<SkillMeta, 'slug' | 'title'>,
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  for (const prefix of [skill.title, skill.slug]) {
    const token = prefix?.trim();
    if (!token) continue;
    if (trimmed === token) return true;
    if (trimmed.startsWith(`${token}\n`) || trimmed.startsWith(`${token} `)) return true;
  }
  return false;
}

/**
 * 编辑回填：去掉 Gateway 时间戳、`[media attached:]`、技能脏前缀、stage-6 占位符，
 * 避免「编辑 → 再发」把元数据再次写进 gateway / 输入框。
 *
 * **换行保真**：`persistedSegmentsToComposer` 会对每个 text segment 传入任务级 skill。
 * `stripSkillGatewayPrefix` 内部 `body.trim()` 会吃掉段首/段尾 `\n`，并把纯 `\n\n`
 * 段落分隔变成空串（随后被 `if (!cleaned) continue` 丢弃），表现为「再编辑换行丢失」。
 * 因此仅当正文看起来真有技能前缀时才剥；剥前缀时仍恢复两侧换行。
 */
export function sanitizePersistedTextSegmentForEdit(
  text: string,
  skill?: Pick<SkillMeta, 'slug' | 'title'>,
): string {
  let cleaned = stripPlanGatePromptForDisplay(stripComposerGatewayPlaceholders(text));
  cleaned = stripGatewayMediaAttached(cleaned);
  // 仅当确有时间戳前缀时才 trimStart，避免吃掉 chip 两侧故意保留的空格。
  const trimmedStart = cleaned.trimStart();
  const withoutTimestamp = stripGatewayTimestampPrefix(trimmedStart);
  if (withoutTimestamp !== trimmedStart) {
    cleaned = withoutTimestamp;
  }
  if ((skill?.slug || skill?.title) && textLooksLikeSkillGatewayPrefix(cleaned, skill)) {
    const leadNl = cleaned.match(/^\r?\n*/)?.[0] ?? '';
    const trailNl = cleaned.match(/\r?\n*$/)?.[0] ?? '';
    const stripped = stripSkillGatewayPrefix(
      cleaned,
      '',
      skill.title ?? '',
      skill.slug,
    );
    cleaned = `${leadNl}${stripped}${trailNl}`;
  }
  return cleaned.replace(/\n{3,}/g, '\n\n');
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
 *
 * `unescapeLiteralNewlines`：仅对 NL 创建的任务开启——把 segments text 里的字面
 * `\n`/`\r`/`\t` 还原成真换行/制表，再走既有清洗。UI 创建的任务可能故意含字面
 * `\n`（正则/代码示例），不应误转，故默认 false。
 */
export function persistedSegmentsToComposer(
  segments: PersistedComposerSegment[],
  preferredAttachments?: ChatEditDraftAttachment[],
  options?: { unescapeLiteralNewlines?: boolean },
): {
  segments: ComposerSegment[];
  attachments: FileAttachment[];
  attachmentsById: Record<string, AttachmentLookupEntry>;
} {
  const unescape = options?.unescapeLiteralNewlines ?? false;
  const attachments: FileAttachment[] = [];
  const attachmentsById: Record<string, AttachmentLookupEntry> = {};
  const composerSegments: ComposerSegment[] = [];
  const usedPreferred = new Set<number>();
  const skillSeg = segments.find((seg) => seg.type === 'skill');
  const skillForSanitize = skillSeg
    ? { slug: skillSeg.slug, title: skillSeg.title }
    : undefined;

  for (const seg of segments) {
    if (seg.type !== 'file') {
      // 禁止通过脏 text segment 再次插入 stage-6 占位符 / Gateway 前缀。
      if (seg.type === 'text') {
        const rawText = unescape ? unescapeLiteralNewlines(seg.text) : seg.text;
        const cleaned = sanitizePersistedTextSegmentForEdit(rawText, skillForSanitize);
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

async function restoreEditDraftAttachments(
  converted: ReturnType<typeof persistedSegmentsToComposer>,
): Promise<ReturnType<typeof persistedSegmentsToComposer>> {
  const paths = converted.attachments.map((attachment) => attachment.stagedPath).filter(Boolean);
  const stat: { exists: Record<string, boolean> } | null = paths.length
    ? await hostApiFetch<{ exists: Record<string, boolean> }>('/api/files/stat', {
        method: 'POST',
        body: JSON.stringify({ paths }),
      }).catch(() => null)
    : { exists: {} };
  if (!stat) return converted;
  const attachments = await Promise.all(converted.attachments.map(async (attachment) => {
    if (attachment.stagedPath && stat.exists[attachment.stagedPath] === true) return attachment;
    if (attachment.provenance?.kind === 'data_center') {
      try {
        const restored = await stageDataCenterSelection({
          entryId: attachment.provenance.entryId,
          name: attachment.fileName,
          mimeType: attachment.mimeType,
          fileSize: attachment.fileSize,
          spaceType: attachment.provenance.spaceType,
          spaceId: attachment.provenance.spaceId,
        });
        return {
          ...attachment,
          fileName: restored.fileName,
          mimeType: restored.mimeType,
          fileSize: restored.fileSize,
          stagedPath: restored.stagedPath,
          preview: restored.preview,
          status: 'ready' as const,
          error: undefined,
        };
      } catch (error) {
        return { ...attachment, status: 'error' as const, error: String(error) };
      }
    }
    return {
      ...attachment,
      status: 'error' as const,
      error: 'File unavailable — please re-attach',
    };
  }));
  const attachmentsById = { ...converted.attachmentsById };
  for (const attachment of attachments) {
    attachmentsById[attachment.id] = {
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      fileSize: attachment.fileSize,
      status: attachment.status,
      preview: attachment.preview,
    };
  }
  return { ...converted, attachments, attachmentsById };
}

export function useInputComposerEditDraft({
  mentionEditorRef,
  editDraft = null,
  onEditDraftApplied,
  onAfterApply,
  onApplyAttachments,
}: UseInputComposerEditDraftOptions) {
  const applyEditDraftText = useCallback(async (detail: ChatEditDraftEventDetail) => {
    const skill = detail.skill;
    const text = sanitizeEditPlainText(detail.text ?? '', skill);
    const prefixText = sanitizeEditPlainText(detail.prefixText ?? '', skill);
    const suffixText = sanitizeEditPlainText(detail.suffixText ?? '', skill);
    const workflow = detail.workflow;
    const hasSegments = Boolean(detail.segments?.length);

    if (!hasSegments && !text && !prefixText && !suffixText && !skill && !workflow) return;

    if (hasSegments && detail.segments) {
      // DOM span 与附件注册表共用同一 ID 空间（preferred 仅补充路径）。
      const converted = await restoreEditDraftAttachments(
        persistedSegmentsToComposer(detail.segments, detail.attachments),
      );
      onApplyAttachments?.(converted.attachments);
      mentionEditorRef.current?.setSegments(converted.segments, converted.attachmentsById);
      mentionEditorRef.current?.focusAtEnd();
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
    mentionEditorRef.current?.focusAtEnd();
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
