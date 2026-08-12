/**
 * 输入能力核心 hook：聚合 snapshot、附件、钉钉 @、三 picker、paste/DnD、基础键盘。
 * Chat / Task 按需挂载；不含语音、发送队列、Gateway。
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
import type { FileAttachment } from '@/components/attachments/types';
import {
  EMPTY_MENTION_COMPOSER_SNAPSHOT,
  type MentionComposerSnapshot,
} from '@/lib/dingtalk-mention-composer';
import { useComposerDingTalkMention } from './use-composer-dingtalk-mention';
import { useInputComposerPickers } from './use-input-composer-pickers';

/** Enter 行为：发送 vs 换行 */
export type InputComposerSubmitMode = 'send' | 'newline';

/** Core 挂载选项；`enable*` 控制能力是否接线 */
export interface UseInputComposerCoreOptions {
  submitMode: InputComposerSubmitMode;
  enableAttachments?: boolean;
  enableSkill?: boolean;
  enableWorkflow?: boolean;
  enableQuickInput?: boolean;
  enableDingTalkMention?: boolean;
  /** Chat：附件 inline 插入编辑器；Task 等保持顶部 chips */
  inlineAttachments?: boolean;
  disabled?: boolean;
  onSubmit?: () => void;
  onSnapshotChange?: (snapshot: MentionComposerSnapshot) => void;
  onKeyDownExtra?: (e: React.KeyboardEvent) => boolean;
  initialSnapshot?: MentionComposerSnapshot;
}

export function useInputComposerCore({
  submitMode,
  enableAttachments = true,
  enableSkill = true,
  enableWorkflow = true,
  enableQuickInput = true,
  enableDingTalkMention = true,
  inlineAttachments = false,
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
  const insertedAttachmentIdsRef = useRef<Set<string>>(new Set());
  const [composerSnapshot, setComposerSnapshot] = useState<MentionComposerSnapshot>(
    () => initialSnapshot ?? EMPTY_MENTION_COMPOSER_SNAPSHOT,
  );
  const [dragOver, setDragOver] = useState(false);

  const handleAttachmentUpsert = useCallback((att: FileAttachment) => {
    if (!inlineAttachments) return;
    if (!insertedAttachmentIdsRef.current.has(att.id)) {
      mentionEditorRef.current?.insertAttachment({
        id: att.id,
        fileName: att.fileName,
        mimeType: att.mimeType,
        fileSize: att.fileSize,
        status: att.status,
        preview: att.preview,
      });
      insertedAttachmentIdsRef.current.add(att.id);
      return;
    }
    mentionEditorRef.current?.updateAttachmentStatus(att.id, att.status, {
      stagedPath: att.stagedPath,
      error: att.error,
    });
  }, [inlineAttachments]);

  const stager = useAttachmentStager(
    inlineAttachments ? { onAttachmentUpsert: handleAttachmentUpsert } : undefined,
  );
  const {
    attachments,
    pickFiles,
    stageBufferFiles,
    stageDataCenterFiles,
    upsertAttachment,
    replaceAttachments,
    setAttachmentsSilent,
    removeAttachment: removeAttachmentFromRegistry,
    clearAttachments,
    clearFailedAttachments,
    allReady,
    hasFailedAttachments,
  } = stager;

  const removeAttachment = useCallback((id: string) => {
    removeAttachmentFromRegistry(id);
    if (inlineAttachments) {
      mentionEditorRef.current?.removeAttachment(id);
      insertedAttachmentIdsRef.current.delete(id);
    }
  }, [inlineAttachments, removeAttachmentFromRegistry]);

  const clearAttachmentsAndTokens = useCallback(() => {
    clearAttachments();
    insertedAttachmentIdsRef.current.clear();
  }, [clearAttachments]);

  const handleAttachmentRemoveFromEditor = useCallback((id: string) => {
    removeAttachmentFromRegistry(id);
    insertedAttachmentIdsRef.current.delete(id);
  }, [removeAttachmentFromRegistry]);

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
    clearAttachmentsAndTokens();
    setMentionTrigger(null);
    setComposerSnapshot(EMPTY_MENTION_COMPOSER_SNAPSHOT);
    pickerMutex.closeAll();
    closeDingTalkMention();
  }, [clearAttachmentsAndTokens, closeDingTalkMention, pickerMutex, setMentionTrigger]);

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
    stageDataCenterFiles,
    upsertAttachment,
    replaceAttachments,
    setAttachmentsSilent,
    removeAttachment,
    handleAttachmentRemoveFromEditor,
    clearAttachments: clearAttachmentsAndTokens,
    clearFailedAttachments,
    allReady,
    hasFailedAttachments,
    inlineAttachments,
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
