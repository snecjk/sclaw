import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { formFieldHoverBorderClass } from '@/lib/surfaces';
import { DingTalkMentionEditor } from '@/components/dingtalk/DingTalkMentionEditor';
import { DingTalkMentionPopover } from '@/components/dingtalk/DingTalkMentionPopover';
import {
  ComposerAttachMenu,
  useComposerAttachSource,
  type FileAttachment,
} from '@/components/attachments';
import { DataCenterFilePickerModal } from '@/components/data-center-file-picker';
import { FlyToTargetLayer } from '@/components/fly-to-target';
import { QuickInputIcon } from '@/components/icons/composer-toolbar-icons';
import {
  InputComposerShell,
  InputComposerToolbar,
  SkillPickerPanel,
  WorkflowPickerPanel,
  QuickInputPickerPanel,
  useInputComposerCore,
} from '@/components/input-composer';
import {
  EMPTY_MENTION_COMPOSER_SNAPSHOT,
  type AttachmentLookupEntry,
  type MentionComposerSnapshot,
  type PersistedComposerSegment,
} from '@/lib/dingtalk-mention-composer';
import {
  persistedSegmentsToComposer,
} from '@/components/input-composer/use-input-composer-edit-draft';
import type { DingTalkMention } from '@/types/dingtalk-mention';
import {
  applyBeautifiedTextToSegments,
  mergeInstructionTextIntoSegments,
} from './task-instruction-composer-segments';

/**
 * 定时任务「任务描述」表单字段。
 * 对齐 Chat 四源附件菜单 + inline token；无语音 / 发送 / Agent / editDraft 事件。
 */
export interface TaskComposerSnapshot extends MentionComposerSnapshot {
  attachments: FileAttachment[];
}

export interface TaskInstructionComposerProps {
  value: string;
  onChange: (text: string) => void;
  initialMentions?: DingTalkMention[];
  /** 编辑回填：有 segments 时优先于 value + initialMentions */
  initialSegments?: PersistedComposerSegment[] | null;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  editorClassName?: string;
  enableAttachments?: boolean;
  enableSkill?: boolean;
  enableWorkflow?: boolean;
  enableQuickInput?: boolean;
  enableDingTalkMention?: boolean;
  /**
   * 标记任务由 NL 创建：回填时对 segments text / instructions 做字面 `\n`→真换行
   * 归一化（模型常把 JSON.stringify 的 `\n` 当字面字符塞进 prompt）。UI 创建
   * 的任务可能故意含字面 `\n`（正则/代码示例），不应误转，故默认 false。
   */
  createdViaNl?: boolean;
  toolbarRight?: ReactNode;
  onSnapshotChange?: (snapshot: TaskComposerSnapshot) => void;
}

export interface TaskInstructionComposerHandle {
  applyBeautifiedText: (text: string) => void;
}

export const TaskInstructionComposer = forwardRef<
  TaskInstructionComposerHandle,
  TaskInstructionComposerProps
>(function TaskInstructionComposer({
  value,
  onChange,
  initialMentions,
  initialSegments,
  placeholder,
  disabled = false,
  invalid = false,
  className,
  editorClassName,
  enableAttachments = true,
  enableSkill = true,
  enableWorkflow = true,
  enableQuickInput = true,
  enableDingTalkMention = true,
  createdViaNl = false,
  toolbarRight,
  onSnapshotChange,
}, ref) {
  const { t } = useTranslation('chat');
  const lastEmittedRef = useRef(value);
  const seededMentionsRef = useRef(false);
  const seededSegmentsRef = useRef(false);
  /** 一旦以 segments 真源回填，禁止再用 setMentions / setPlainText 覆盖（会 innerHTML 清空） */
  const lockSegmentsSeed = Boolean(initialSegments && initialSegments.length > 0);
  const lockSegmentsSeedRef = useRef(lockSegmentsSeed);

  const handleSnapshot = useCallback(
    (snapshot: MentionComposerSnapshot) => {
      lastEmittedRef.current = snapshot.plainText;
      onChange(snapshot.plainText);
    },
    [onChange],
  );

  const core = useInputComposerCore({
    submitMode: 'newline',
    inlineAttachments: enableAttachments,
    enableAttachments,
    enableSkill,
    enableWorkflow,
    enableQuickInput,
    enableDingTalkMention,
    disabled,
    onSnapshotChange: handleSnapshot,
    initialSnapshot: {
      ...EMPTY_MENTION_COMPOSER_SNAPSHOT,
      // segments 真源时不要用 mentions 预填 snapshot，避免与后续 setSegments 打架
      plainText: lockSegmentsSeed ? '' : value,
      mentions: lockSegmentsSeed ? [] : (initialMentions ?? []),
      isEmpty: lockSegmentsSeed ? true : !value.trim(),
    },
  });

  const {
    mentionEditorRef,
    composerShellRef,
    mentionPopoverHostRef,
    isComposingRef,
    dragOver,
    attachments,
    pickFiles,
    stageDataCenterFiles,
    setAttachmentsSilent,
    dingTalkPopoverProps,
    setMentionTrigger,
    skillPicker,
    workflowPicker,
    quickInputPicker,
    handleComposerSnapshotChange,
    handleKeyDown,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    getSnapshot,
    handleAttachmentRemoveFromEditor,
  } = core;

  const attachSource = useComposerAttachSource({
    pickFiles,
    stageDataCenterFiles,
  });

  const onSnapshotChangeRef = useRef(onSnapshotChange);
  useEffect(() => {
    onSnapshotChangeRef.current = onSnapshotChange;
  }, [onSnapshotChange]);

  const emitSnapshot = useCallback(
    (snapshot: MentionComposerSnapshot) => {
      onSnapshotChangeRef.current?.({
        ...snapshot,
        attachments,
      });
    },
    [attachments],
  );

  const handleComposerSnapshot = useCallback(
    (snapshot: MentionComposerSnapshot) => {
      handleComposerSnapshotChange(snapshot);
      emitSnapshot(snapshot);
    },
    [emitSnapshot, handleComposerSnapshotChange],
  );

  useImperativeHandle(ref, () => ({
    applyBeautifiedText: (text: string) => {
      const editor = mentionEditorRef.current;
      if (!editor) {
        lastEmittedRef.current = text;
        onChange(text);
        return;
      }
      const snap = editor.getSnapshot();
      const nextSegments = applyBeautifiedTextToSegments(snap.segments, text);
      const attachmentsById: Record<string, AttachmentLookupEntry> = {};
      for (const att of attachments) {
        attachmentsById[att.id] = {
          id: att.id,
          fileName: att.fileName,
          mimeType: att.mimeType,
          fileSize: att.fileSize,
          status: att.status,
          preview: att.preview,
        };
      }
      editor.setSegments(nextSegments, attachmentsById);
      const after = editor.getSnapshot();
      lastEmittedRef.current = after.plainText;
    },
  }), [attachments, mentionEditorRef, onChange]);

  useEffect(() => {
    // 附件状态变化时也通知 Modal（保存时需 ready 列表）
    // 刻意不依赖 getSnapshot：其随 composerSnapshot 每键更新，会与父级 setState 叠加重触发
    emitSnapshot(getSnapshot());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅 attachments / emitSnapshot
  }, [attachments, emitSnapshot]);

  useLayoutEffect(() => {
    if (!lockSegmentsSeedRef.current || seededSegmentsRef.current) return;
    if (!initialSegments?.length) return;

    let cancelled = false;
    let attempts = 0;

    const apply = () => {
      if (cancelled || seededSegmentsRef.current) return;
      const editor = mentionEditorRef.current;
      if (!editor) {
        attempts += 1;
        if (attempts < 20) {
          requestAnimationFrame(apply);
        }
        return;
      }

      const merged = mergeInstructionTextIntoSegments(initialSegments, value, {
        unescapeLiteralNewlines: createdViaNl,
      });
      const converted = persistedSegmentsToComposer(merged, undefined, {
        unescapeLiteralNewlines: createdViaNl,
      });
      setAttachmentsSilent(converted.attachments);
      editor.setSegments(converted.segments, converted.attachmentsById);
      const snap = editor.getSnapshot();
      if (snap) {
        lastEmittedRef.current = snap.plainText;
        onChange(snap.plainText);
        emitSnapshot(snap);
      }
      seededSegmentsRef.current = true;
      seededMentionsRef.current = true;
    };

    apply();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount seed only
  }, []);

  useEffect(() => {
    if (lockSegmentsSeedRef.current || seededSegmentsRef.current) return;

    mentionEditorRef.current?.setPlainText(value);
    if (initialMentions && initialMentions.length > 0) {
      mentionEditorRef.current?.setMentions(initialMentions);
      seededMentionsRef.current = true;
    }
    lastEmittedRef.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount seed only
  }, []);

  useEffect(() => {
    if (lockSegmentsSeedRef.current || seededSegmentsRef.current) return;
    if (value === lastEmittedRef.current) return;
    const editor = mentionEditorRef.current;
    if (!editor) return;
    const snap = editor.getSnapshot();
    const hasChips = snap.segments.some((seg) => seg.type !== 'text');
    lastEmittedRef.current = value;
    // setPlainText + setMentions 会清空 chip，且文末 @ 会丢分隔空格。
    if (hasChips) return;
    editor.setPlainText(value);
    if (snap.mentions.length > 0) {
      editor.setMentions(snap.mentions);
    }
  }, [mentionEditorRef, value]);

  useEffect(() => {
    if (lockSegmentsSeedRef.current || seededMentionsRef.current || seededSegmentsRef.current) {
      return;
    }
    if (!initialMentions || initialMentions.length === 0) return;
    mentionEditorRef.current?.setMentions(initialMentions);
    seededMentionsRef.current = true;
  }, [mentionEditorRef, initialMentions]);

  const showToolbar =
    enableAttachments || enableSkill || enableWorkflow || enableQuickInput;

  return (
    <div className={cn('w-full', className)}>
      {enableQuickInput ? (
        <FlyToTargetLayer targetRef={quickInputPicker.buttonRef}>
          <QuickInputIcon className="h-full w-full text-foreground" />
        </FlyToTargetLayer>
      ) : null}
      <InputComposerShell
        ref={composerShellRef}
        layout="default"
        dragOver={dragOver}
        hasChips={false}
        onDragOver={enableAttachments ? handleDragOver : undefined}
        onDragLeave={enableAttachments ? handleDragLeave : undefined}
        onDrop={enableAttachments ? handleDrop : undefined}
        className={cn(
          'sto-control--task-create-focus flex h-[276px] flex-col rounded-[8px] border shadow-none ring-0',
          'hover:shadow-none dark:hover:shadow-none',
          formFieldHoverBorderClass,
          invalid
            ? 'border-destructive shadow-[0_0_0_3px_rgba(220,38,38,0.12)] hover:border-destructive focus-within:border-destructive'
            : null,
          disabled && 'cursor-not-allowed opacity-70',
        )}
        mentionPopover={
          enableDingTalkMention ? (
            <DingTalkMentionPopover {...dingTalkPopoverProps} />
          ) : null
        }
        chips={null}
        editorOrOverlay={(
          <div ref={mentionPopoverHostRef} className="relative flex min-h-0 flex-1 flex-col overflow-visible">
            <DingTalkMentionEditor
              ref={mentionEditorRef}
              placeholder={placeholder}
              disabled={disabled}
              className={cn(
                // 字号/行高/占位色与首页 ChatInput 共用 DingTalkMentionEditor 默认
                //（text-[14px] leading-8）；仅保留任务框高度与多行 placeholder
                'h-full min-h-0 max-h-none flex-1',
                'empty:before:whitespace-pre-wrap',
                editorClassName,
              )}
              onSnapshotChange={handleComposerSnapshot}
              onTriggerChange={enableDingTalkMention ? setMentionTrigger : undefined}
              onTextInput={enableWorkflow ? workflowPicker.handleTextInput : undefined}
              onKeyDown={handleKeyDown}
              onPaste={enableAttachments ? handlePaste : undefined}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              onAttachmentRemove={enableAttachments
                ? handleAttachmentRemoveFromEditor
                : undefined}
            />
            {enableSkill ? (
              <SkillPickerPanel
                pickerRef={skillPicker.pickerRef}
                {...skillPicker.panelProps}
              />
            ) : null}
            {enableWorkflow ? (
              <WorkflowPickerPanel
                pickerRef={workflowPicker.pickerRef}
                {...workflowPicker.panelProps}
              />
            ) : null}
            {enableQuickInput ? (
              <QuickInputPickerPanel
                pickerRef={quickInputPicker.pickerRef}
                {...quickInputPicker.panelProps}
              />
            ) : null}
          </div>
        )}
        toolbarLeft={
          showToolbar ? (
            <InputComposerToolbar
              layout="default"
              disabled={disabled}
              labels={{
                attach: t('composer.attachFiles'),
                skill: t('composer.pickSkill'),
                workflow: t('composer.pickWorkflow'),
                quickInput: t('composer.quickInputTitle'),
              }}
              showAttach={enableAttachments}
              showSkill={enableSkill}
              showWorkflow={enableWorkflow}
              showQuickInput={enableQuickInput}
              onAttach={attachSource.openAttachMenu}
              onSkill={skillPicker.toggleToolbar}
              onWorkflow={workflowPicker.toggleToolbar}
              onQuickInput={quickInputPicker.toggle}
              onSaveCaret={() => mentionEditorRef.current?.saveCaret()}
              skillActive={skillPicker.open && skillPicker.mode === 'toolbar'}
              workflowActive={workflowPicker.open}
              quickInputActive={quickInputPicker.open}
              skillButtonRef={skillPicker.buttonRef}
              workflowButtonRef={workflowPicker.buttonRef}
              quickInputButtonRef={quickInputPicker.buttonRef}
              attachButtonRef={attachSource.attachButtonRef}
            />
          ) : null
        }
        toolbarRight={toolbarRight}
      />
      {enableAttachments ? (
        <>
          <ComposerAttachMenu
            open={attachSource.menuOpen}
            onOpenChange={attachSource.setMenuOpen}
            anchorRef={attachSource.attachButtonRef}
            showSharedArtifact={attachSource.showSharedArtifact}
            onSelect={attachSource.handleMenuSelect}
            labels={{
              local: t('composer.attachLocal'),
              drive: t('composer.attachDrive'),
              qaArtifact: t('composer.attachQaArtifact'),
              siteSharedArtifact: t('composer.attachSiteShared'),
            }}
          />
          <DataCenterFilePickerModal
            open={attachSource.pickerOpen}
            type={attachSource.pickerType}
            onClose={attachSource.closePicker}
            onConfirm={(files) => { void attachSource.handlePickerConfirm(files); }}
          />
        </>
      ) : null}
    </div>
  );
});
