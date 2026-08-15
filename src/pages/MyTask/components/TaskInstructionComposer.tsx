import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { formFieldFocusClass } from '@/lib/surfaces';
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
  type MentionComposerSnapshot,
  type PersistedComposerSegment,
} from '@/lib/dingtalk-mention-composer';
import {
  persistedSegmentsToComposer,
} from '@/components/input-composer/use-input-composer-edit-draft';
import { unescapeLiteralNewlines } from '../../../../shared/text-escape';
import { reconstructComposerSegmentsFromPrompt } from '../../../../shared/scheduled-task-composer-segments';
import type { DingTalkMention } from '@/types/dingtalk-mention';

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

/**
 * NL 落库常把正文只放在 prompt、segments 里只有 chip。
 * 编辑回填时把干净正文织进 segments，避免只剩 @/文件 chip。
 *
 * `unescapeLiteralNewlines`：仅对 NL 创建的任务开启——先把 instructions 里的字面
 * `\n`/`\r`/`\t` 还原成真换行/制表再清洗。UI 创建的任务可能故意含字面 `\n`
 * （正则/代码示例），不应误转，故默认 false。
 */
export function mergeInstructionTextIntoSegments(
  segments: PersistedComposerSegment[],
  instructions: string,
  options?: { unescapeLiteralNewlines?: boolean },
): PersistedComposerSegment[] {
  const hasText = segments.some((seg) => seg.type === 'text' && seg.text.trim());
  if (hasText) return segments;

  const prompt = options?.unescapeLiteralNewlines
    ? unescapeLiteralNewlines(instructions)
    : instructions;

  const attachments = segments
    .filter((s): s is Extract<PersistedComposerSegment, { type: 'file' }> => s.type === 'file')
    .map((s) => ({
      fileName: s.fileName,
      mimeType: s.mimeType || 'application/octet-stream',
      sourcePath: s.filePath || s.stagedPath || '',
      persistentPath: s.filePath || s.stagedPath || '',
      provenance: s.provenance as { kind: string; [key: string]: unknown } | undefined,
    }));
  const skills = segments
    .filter((s): s is Extract<PersistedComposerSegment, { type: 'skill' }> => s.type === 'skill')
    .map((s) => ({ slug: s.slug, title: s.title }));
  const mentions = segments
    .filter((s): s is Extract<PersistedComposerSegment, { type: 'mention' }> => s.type === 'mention')
    .map((s) => s.mention);
  const workflows = segments.filter(
    (s): s is Extract<PersistedComposerSegment, { type: 'workflow' }> => s.type === 'workflow',
  );
  const wfSeg = workflows[0];

  const reconstructed = reconstructComposerSegmentsFromPrompt({
    prompt,
    attachments,
    skills,
    mentions,
    workflowCode: wfSeg?.id,
    workflowName: wfSeg?.name,
  }) as PersistedComposerSegment[];

  const usedWorkflowIds = new Set(
    reconstructed
      .filter((s): s is Extract<PersistedComposerSegment, { type: 'workflow' }> => s.type === 'workflow')
      .map((s) => s.id),
  );
  const leftoverWorkflows = workflows.filter((w) => !usedWorkflowIds.has(w.id));
  return leftoverWorkflows.length > 0
    ? [...reconstructed, ...leftoverWorkflows]
    : reconstructed;
}

export function TaskInstructionComposer({
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
}: TaskInstructionComposerProps) {
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
    const mentions = mentionEditorRef.current?.getSnapshot().mentions ?? [];
    lastEmittedRef.current = value;
    mentionEditorRef.current?.setPlainText(value);
    if (mentions.length > 0) {
      mentionEditorRef.current?.setMentions(mentions);
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
        chips={null}
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
}
