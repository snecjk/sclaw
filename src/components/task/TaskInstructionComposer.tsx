import {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { formFieldFocusClass } from '@/lib/surfaces';
import { DingTalkMentionEditor } from '@/components/dingtalk/DingTalkMentionEditor';
import { DingTalkMentionPopover } from '@/components/dingtalk/DingTalkMentionPopover';
import { AttachmentChips } from '@/components/attachments';
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
import type { MentionComposerSnapshot } from '@/lib/dingtalk-mention-composer';
import type { DingTalkMention } from '@/types/dingtalk-mention';

/**
 * 定时任务「任务描述」表单字段。
 * 在本文件内按需插拔组装 Shell / Editor / Panels / Toolbar；无语音 / 发送 / Agent。
 */
export interface TaskInstructionComposerProps {
  value: string;
  onChange: (text: string) => void;
  initialMentions?: DingTalkMention[];
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
  toolbarRight?: ReactNode;
  onSnapshotChange?: (snapshot: MentionComposerSnapshot) => void;
}

export function TaskInstructionComposer({
  value,
  onChange,
  initialMentions,
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
  toolbarRight,
  onSnapshotChange,
}: TaskInstructionComposerProps) {
  const { t } = useTranslation('chat');
  const lastEmittedRef = useRef(value);
  const seededMentionsRef = useRef(false);

  const handleSnapshot = useCallback(
    (snapshot: MentionComposerSnapshot) => {
      lastEmittedRef.current = snapshot.plainText;
      onChange(snapshot.plainText);
      onSnapshotChange?.(snapshot);
    },
    [onChange, onSnapshotChange],
  );

  const core = useInputComposerCore({
    submitMode: 'newline',
    enableAttachments,
    enableSkill,
    enableWorkflow,
    enableQuickInput,
    enableDingTalkMention,
    disabled,
    onSnapshotChange: handleSnapshot,
    initialSnapshot: {
      plainText: value,
      mentions: initialMentions ?? [],
      isEmpty: !value.trim(),
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
    removeAttachment,
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
  } = core;

  useEffect(() => {
    mentionEditorRef.current?.setPlainText(value);
    if (initialMentions && initialMentions.length > 0) {
      mentionEditorRef.current?.setMentions(initialMentions);
      seededMentionsRef.current = true;
    }
    lastEmittedRef.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount seed only
  }, []);

  useEffect(() => {
    if (value === lastEmittedRef.current) return;
    const mentions = mentionEditorRef.current?.getSnapshot().mentions ?? [];
    lastEmittedRef.current = value;
    mentionEditorRef.current?.setPlainText(value);
    if (mentions.length > 0) {
      mentionEditorRef.current?.setMentions(mentions);
    }
  }, [mentionEditorRef, value]);

  useEffect(() => {
    if (seededMentionsRef.current) return;
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
        hasChips={enableAttachments && attachments.length > 0}
        onDragOver={enableAttachments ? handleDragOver : undefined}
        onDragLeave={enableAttachments ? handleDragLeave : undefined}
        onDrop={enableAttachments ? handleDrop : undefined}
        className={cn(
          'rounded-[10px] shadow-none ring-0',
          formFieldFocusClass,
          invalid
            ? 'border-destructive shadow-[0_0_0_3px_rgba(220,38,38,0.12)]'
            : 'border-border',
          disabled && 'cursor-not-allowed opacity-70',
        )}
        mentionPopover={
          enableDingTalkMention ? (
            <DingTalkMentionPopover {...dingTalkPopoverProps} />
          ) : null
        }
        chips={
          enableAttachments ? (
            <AttachmentChips attachments={attachments} onRemove={removeAttachment} />
          ) : null
        }
        editorOrOverlay={(
          <div ref={mentionPopoverHostRef} className="relative flex-1 overflow-visible">
            <DingTalkMentionEditor
              ref={mentionEditorRef}
              placeholder={placeholder}
              disabled={disabled}
              className={cn(
                'min-h-[160px] max-h-[280px] text-sm leading-relaxed',
                editorClassName,
              )}
              onSnapshotChange={handleComposerSnapshotChange}
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
              onAttach={() => { void pickFiles(); }}
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
            />
          ) : null
        }
        toolbarRight={toolbarRight}
      />
    </div>
  );
}
