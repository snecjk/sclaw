/**
 * 编辑重发草稿：监听 `CHAT_EDIT_DRAFT_EVENT` + `editDraft` prop，写入 MentionEditor。
 * Chat 按需挂载；Task 不挂。
 *
 * ## Types
 * - `ChatDraftWorkflowMeta` — 草稿里附带的工作流元数据（id/name/source）
 * - `ChatEditDraftEventDetail` — 自定义事件 detail（text/skill/workflow/前后缀）
 * - `UseInputComposerEditDraftOptions` — editor ref、editDraft prop、应用后回调
 */
import { useCallback, useEffect, type RefObject } from 'react';
import type { DingTalkMentionEditorHandle } from '@/components/dingtalk/DingTalkMentionEditor';
import type { SkillMeta } from '@/types/skill-meta';

/** window 自定义事件名，与 ChatMessage 派发侧保持一致 */
export const CHAT_EDIT_DRAFT_EVENT = 'stoclaw:chat-edit-draft';

/** 草稿中的工作流片段 */
export interface ChatDraftWorkflowMeta {
  /** 工作流 id */
  id: string;
  /** 展示名 */
  name: string;
  /** 来源标识（可选） */
  source?: string;
}

/** `CHAT_EDIT_DRAFT_EVENT` 的 detail；字段均可选，有则按序写入编辑器 */
export interface ChatEditDraftEventDetail {
  /** 主正文 */
  text?: string;
  /** 附带技能 chip */
  skill?: SkillMeta;
  /** 附带工作流 chip */
  workflow?: ChatDraftWorkflowMeta;
  /** 插在正文前的纯文本 */
  prefixText?: string;
  /** 插在正文后的纯文本 */
  suffixText?: string;
}

/** editDraft prop 与事件共用的接线选项 */
export interface UseInputComposerEditDraftOptions {
  /** MentionEditor 句柄 */
  mentionEditorRef: RefObject<DingTalkMentionEditorHandle | null>;
  /** 受控草稿；`version` 变化触发回填 */
  editDraft?: {
    /** 草稿正文 */
    text: string;
    /** 可选技能 */
    skill?: SkillMeta;
    /** 变更版本号，用于同一 text 重复应用 */
    version: number;
  } | null;
  /** 受控草稿应用完成后通知父层（可清 editDraft） */
  onEditDraftApplied?: () => void;
  /** 写入草稿后的清理（关 picker、清附件等） */
  onAfterApply?: () => void;
}

export function useInputComposerEditDraft({
  mentionEditorRef,
  editDraft = null,
  onEditDraftApplied,
  onAfterApply,
}: UseInputComposerEditDraftOptions) {
  const applyEditDraftText = useCallback((detail: ChatEditDraftEventDetail) => {
    const text = detail.text?.trim() ?? '';
    const prefixText = detail.prefixText?.trim() ?? '';
    const suffixText = detail.suffixText?.trim() ?? '';
    const skill = detail.skill;
    const workflow = detail.workflow;
    if (!text && !prefixText && !suffixText && !skill && !workflow) return;

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
  }, [mentionEditorRef, onAfterApply]);

  useEffect(() => {
    if (!editDraft) return;
    applyEditDraftText({ text: editDraft.text, skill: editDraft.skill });
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
      });
    };

    window.addEventListener(CHAT_EDIT_DRAFT_EVENT, handleEditDraftEvent);
    return () => {
      window.removeEventListener(CHAT_EDIT_DRAFT_EVENT, handleEditDraftEvent);
    };
  }, [applyEditDraftText]);

  return { applyEditDraftText };
}
