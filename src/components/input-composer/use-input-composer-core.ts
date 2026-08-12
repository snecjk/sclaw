/**
 * 输入能力核心 hook：聚合 snapshot、附件、钉钉 @、三 picker、paste/DnD、基础键盘。
 * Chat / Task 按需挂载；不含语音、发送队列、Gateway。
 *
 * ## Types
 * - `InputComposerSubmitMode` — `'send'`（Enter 提交）| `'newline'`（Enter 换行，Task 用）
 * - `UseInputComposerCoreOptions` — 能力开关、提交回调、初始 snapshot、额外键盘处理
 * - `InputComposerCore` — hook 返回值（refs / snapshot / pickers / 事件 handler）
 */
import {
  useCallback,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react';
import type { DingTalkMentionEditorHandle } from '@/components/dingtalk/DingTalkMentionEditor';
import { useAttachmentStager } from '@/components/attachments';
import type { MentionComposerSnapshot } from '@/lib/dingtalk-mention-composer';
import { useComposerDingTalkMention } from './use-composer-dingtalk-mention';
import { useInputComposerPickers } from './use-input-composer-pickers';

/** Enter 行为：发送 vs 换行 */
export type InputComposerSubmitMode = 'send' | 'newline';

/** Core 挂载选项；`enable*` 控制能力是否接线 */
export interface UseInputComposerCoreOptions {
  /** Enter：`'send'` 提交 / `'newline'` 换行 */
  submitMode: InputComposerSubmitMode;
  /** 是否启用附件（粘贴 / DnD / 选文件） */
  enableAttachments?: boolean;
  /** 是否启用技能 picker */
  enableSkill?: boolean;
  /** 是否启用工作流 picker */
  enableWorkflow?: boolean;
  /** 是否启用快捷输入 picker */
  enableQuickInput?: boolean;
  /** 是否启用钉钉 @ 提及 */
  enableDingTalkMention?: boolean;
  /** 禁用编辑与交互 */
  disabled?: boolean;
  /** send 模式：Enter（无 Shift）触发 */
  onSubmit?: () => void;
  /** 编辑器 snapshot 变化回调 */
  onSnapshotChange?: (snapshot: MentionComposerSnapshot) => void;
  /**
   * 在 core 处理提及导航 / Escape / Enter-send 之后调用。
   * 返回 true 表示已处理，不再继续。
   */
  onKeyDownExtra?: (e: React.KeyboardEvent) => boolean;
  /** 初始 snapshot（如表单预填文案） */
  initialSnapshot?: MentionComposerSnapshot;
}

export function useInputComposerCore({
  submitMode,
  enableAttachments = true,
  enableSkill = true,
  enableWorkflow = true,
  enableQuickInput = true,
  enableDingTalkMention = true,
  disabled = false,
  onSubmit,
  onSnapshotChange,
  onKeyDownExtra,
  initialSnapshot,
}: UseInputComposerCoreOptions) {
  const mentionEditorRef = useRef<DingTalkMentionEditorHandle>(null);
  const composerShellRef = useRef<HTMLDivElement>(null);
  const mentionPopoverHostRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const [composerSnapshot, setComposerSnapshot] = useState<MentionComposerSnapshot>(
    () => initialSnapshot ?? {
      plainText: '',
      mentions: [],
      isEmpty: true,
    },
  );
  const [dragOver, setDragOver] = useState(false);

  const stager = useAttachmentStager();
  const {
    attachments,
    pickFiles,
    stageBufferFiles,
    removeAttachment,
    clearAttachments,
    clearFailedAttachments,
    allReady,
    hasFailedAttachments,
  } = stager;

  const dingTalkMention = useComposerDingTalkMention({
    mentionEditorRef,
    enabled: enableDingTalkMention,
    isComposingRef,
  });
  const {
    setMentionTrigger,
    closeDingTalkMention,
    closeForWorkflowSlash,
    handleMentionKeyDown,
    popoverProps: dingTalkPopoverProps,
  } = dingTalkMention;

  const {
    mutex: pickerMutex,
    skillPicker,
    workflowPicker,
    quickInputPicker,
    closePickersOnEscape,
  } = useInputComposerPickers({
    mentionEditorRef,
    plainText: composerSnapshot.plainText,
    mentionPopoverHostRef,
    isComposingRef,
    composerShellRef,
    closeOthers: closeForWorkflowSlash,
    enableSkill,
    enableWorkflow,
    enableQuickInput,
  });

  const handleComposerSnapshotChange = useCallback(
    (snapshot: MentionComposerSnapshot) => {
      setComposerSnapshot(snapshot);
      if (enableWorkflow) {
        workflowPicker.onSnapshotChange(snapshot);
      }
      onSnapshotChange?.(snapshot);
    },
    [enableWorkflow, onSnapshotChange, workflowPicker.onSnapshotChange],
  );

  const clearComposer = useCallback(() => {
    mentionEditorRef.current?.clear();
    clearAttachments();
    setMentionTrigger(null);
    setComposerSnapshot({
      plainText: '',
      mentions: [],
      isEmpty: true,
    });
    pickerMutex.closeAll();
    closeDingTalkMention();
  }, [clearAttachments, closeDingTalkMention, pickerMutex, setMentionTrigger]);

  const getSnapshot = useCallback((): MentionComposerSnapshot => {
    return mentionEditorRef.current?.getSnapshot() ?? composerSnapshot;
  }, [composerSnapshot]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (enableDingTalkMention && handleMentionKeyDown(e)) return;
      if (closePickersOnEscape(e)) return;
      if (onKeyDownExtra?.(e)) return;

      if (submitMode === 'send' && e.key === 'Enter' && !e.shiftKey) {
        if (skillPicker.open) return;
        const nativeEvent = e.nativeEvent as KeyboardEvent;
        if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
          return;
        }
        e.preventDefault();
        onSubmit?.();
      }
      // newline 模式：不 preventDefault Enter
    },
    [
      closePickersOnEscape,
      enableDingTalkMention,
      handleMentionKeyDown,
      onKeyDownExtra,
      onSubmit,
      skillPicker.open,
      submitMode,
    ],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!enableAttachments) return;
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
    [enableAttachments, stageBufferFiles],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!enableAttachments || disabled) return;
      e.preventDefault();
      e.stopPropagation();
      setDragOver(true);
    },
    [disabled, enableAttachments],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!enableAttachments) return;
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
    },
    [enableAttachments],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!enableAttachments || disabled) return;
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (e.dataTransfer?.files?.length) {
        void stageBufferFiles(Array.from(e.dataTransfer.files));
      }
    },
    [disabled, enableAttachments, stageBufferFiles],
  );

  return {
    mentionEditorRef: mentionEditorRef as RefObject<DingTalkMentionEditorHandle | null>,
    composerShellRef: composerShellRef as RefObject<HTMLDivElement | null>,
    mentionPopoverHostRef: mentionPopoverHostRef as RefObject<HTMLDivElement | null>,
    isComposingRef: isComposingRef as MutableRefObject<boolean>,
    composerSnapshot,
    setComposerSnapshot,
    dragOver,
    attachments,
    pickFiles,
    stageBufferFiles,
    removeAttachment,
    clearAttachments,
    clearFailedAttachments,
    allReady,
    hasFailedAttachments,
    enableAttachments,
    enableSkill,
    enableWorkflow,
    enableQuickInput,
    enableDingTalkMention,
    dingTalkPopoverProps,
    setMentionTrigger,
    closeDingTalkMention,
    skillPicker,
    workflowPicker,
    quickInputPicker,
    pickerMutex,
    handleComposerSnapshotChange,
    handleKeyDown,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    clearComposer,
    getSnapshot,
  };
}

/** Core 返回值：编辑 refs、附件、提及 popover props、三 picker、拖放/键盘 handler */
export type InputComposerCore = ReturnType<typeof useInputComposerCore>;
