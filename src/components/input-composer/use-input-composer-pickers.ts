/**
 * 三 picker 聚合：mutex + skill / workflow / quick controller。
 * ChatInput 与 TaskInstructionComposer 各调一次，避免 glue 双份。
 *
 * ## Types
 * - `UseInputComposerPickersOptions` — editor/plainText/host refs、closeOthers、enable*
 * - `InputComposerPickers` — `{ mutex, skillPicker, workflowPicker, quickInputPicker, closePickersOnEscape }`
 */
import { useCallback, type MutableRefObject, type RefObject } from 'react';
import type { DingTalkMentionEditorHandle } from '@/components/dingtalk/DingTalkMentionEditor';
import { useInputComposerPickerMutex } from './use-input-composer-picker-mutex';
import { useSkillPickerController } from './use-skill-picker-controller';
import { useWorkflowPickerController } from './use-workflow-picker-controller';
import { useQuickInputPickerController } from './use-quick-input-picker-controller';

/** 聚合 hook 选项；`closeOthers` 常用于开 slash 时关钉钉 mention */
export interface UseInputComposerPickersOptions {
  /** MentionEditor 句柄，下发给各 controller */
  mentionEditorRef: RefObject<DingTalkMentionEditorHandle | null>;
  /** 当前纯文本（技能/工作流 inline query） */
  plainText: string;
  /** 技能 inline 定位与点击外部 host */
  mentionPopoverHostRef: RefObject<HTMLElement | null>;
  /** IME 组合输入中标记 */
  isComposingRef: MutableRefObject<boolean>;
  /** 输入壳 DOM（工作流定位等） */
  composerShellRef: RefObject<HTMLElement | null>;
  /** 开 workflow slash 时由装配层注入（如关钉钉 mention） */
  closeOthers?: () => void;
  /** 是否挂载技能 picker；默认 true */
  enableSkill?: boolean;
  /** 是否挂载工作流 picker；默认 true */
  enableWorkflow?: boolean;
  /** 是否挂载快捷输入 picker；默认 true */
  enableQuickInput?: boolean;
}

export function useInputComposerPickers({
  mentionEditorRef,
  plainText,
  mentionPopoverHostRef,
  isComposingRef,
  composerShellRef,
  closeOthers,
  enableSkill = true,
  enableWorkflow = true,
  enableQuickInput = true,
}: UseInputComposerPickersOptions) {
  const mutex = useInputComposerPickerMutex();

  const skillPicker = useSkillPickerController({
    open: enableSkill ? mutex.skillPickerOpen : false,
    setOpen: mutex.setSkillPickerOpen,
    mode: mutex.skillPickerMode,
    setMode: mutex.setSkillPickerMode,
    toggleToolbarFromMutex: mutex.toggleSkillToolbar,
    mentionEditorRef,
    plainText,
    mentionPopoverHostRef,
  });

  const workflowPicker = useWorkflowPickerController({
    open: enableWorkflow ? mutex.workflowPickerOpen : false,
    setOpen: mutex.setWorkflowPickerOpen,
    slashOpenRef: mutex.workflowPickerSlashOpenRef,
    setSkillPickerOpen: mutex.setSkillPickerOpen,
    setQuickInputPickerOpen: mutex.setQuickInputPickerOpen,
    toggleToolbarFromMutex: mutex.toggleWorkflowToolbar,
    mentionEditorRef,
    plainText,
    isComposingRef,
    composerShellRef,
    closeOthers,
  });

  const quickInputPicker = useQuickInputPickerController({
    open: enableQuickInput ? mutex.quickInputPickerOpen : false,
    setOpen: mutex.setQuickInputPickerOpen,
    toggleFromMutex: mutex.toggleQuickInput,
    mentionEditorRef,
  });

  const closePickersOnEscape = useCallback(
    (e: { key: string; preventDefault: () => void }): boolean => {
      if (e.key !== 'Escape') return false;
      if (enableSkill && skillPicker.open) {
        e.preventDefault();
        skillPicker.close();
        return true;
      }
      if (enableQuickInput && quickInputPicker.open) {
        e.preventDefault();
        quickInputPicker.close();
        return true;
      }
      if (enableWorkflow && workflowPicker.open) {
        e.preventDefault();
        workflowPicker.close();
        return true;
      }
      return false;
    },
    [
      enableQuickInput,
      enableSkill,
      enableWorkflow,
      quickInputPicker,
      skillPicker,
      workflowPicker,
    ],
  );

  return {
    mutex,
    skillPicker,
    workflowPicker,
    quickInputPicker,
    closePickersOnEscape,
  };
}

/** 三 picker + mutex 聚合返回值 */
export type InputComposerPickers = ReturnType<typeof useInputComposerPickers>;
