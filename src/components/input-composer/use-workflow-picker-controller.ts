/**
 * 工作流 picker 控制器：toolbar / `/` slash 双模式、query 提取、选中插入。
 * open 由 mutex 持有；`slashOpenRef` 标记是否 slash 打开。
 *
 * ## Types
 * - `UseWorkflowPickerControllerOptions` — open、slashOpenRef、关其它 picker、editor/plainText、IME/shell refs
 * - 返回值含 `panelProps`、`handleTextInput`（编辑器 onTextInput）
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
  type RefObject,
} from 'react';
import type { DingTalkMentionEditorHandle } from '@/components/dingtalk/DingTalkMentionEditor';
import {
  extractSlashInlineQuery,
  type MentionComposerSnapshot,
} from '@/lib/dingtalk-mention-composer';
import type { WorkflowPickerPanelProps } from './WorkflowPickerPanel';

/** 控制器选项；`closeOthers` 常用于开 slash 时关钉钉 mention */
export interface UseWorkflowPickerControllerOptions {
  /** 面板是否打开（由 mutex 持有） */
  open: boolean;
  /** 设置打开态；支持函数式更新 */
  setOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  /** 是否为 `/` slash 打开（true=slash，false=toolbar） */
  slashOpenRef: MutableRefObject<boolean>;
  /** 互斥：关闭技能 picker */
  setSkillPickerOpen: (open: boolean) => void;
  /** 互斥：关闭快捷输入 picker */
  setQuickInputPickerOpen: (open: boolean) => void;
  /** mutex 提供的工具栏互斥 toggle */
  toggleToolbarFromMutex: () => void;
  /** MentionEditor 句柄（插工作流 / 保存光标） */
  mentionEditorRef: RefObject<DingTalkMentionEditorHandle | null>;
  /** 当前纯文本，用于提取 slash query */
  plainText: string;
  /** IME 组合输入中标记，组合期间不处理 slash */
  isComposingRef: MutableRefObject<boolean>;
  /** 输入壳 DOM，用于定位 / 点击外部判断 */
  composerShellRef: RefObject<HTMLElement | null>;
  /** 开 slash 时由装配层注入（如关 dingTalk mention） */
  closeOthers?: () => void;
  /**
   * 选中工作流后清除 pending workflow（Chat 注入 useChatStore.clearPendingWorkflow）。
   * Task 等非 Chat 场景不传，避免误碰 Chat store。
   */
  onClearPendingWorkflow?: () => void;
}

export function useWorkflowPickerController({
  open,
  setOpen,
  slashOpenRef,
  setSkillPickerOpen,
  setQuickInputPickerOpen,
  toggleToolbarFromMutex,
  mentionEditorRef,
  plainText,
  isComposingRef,
  composerShellRef,
  closeOthers,
  onClearPendingWorkflow,
}: UseWorkflowPickerControllerOptions) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const query = useMemo(() => {
    if (!slashOpenRef.current) return '';
    // 相对光标截取：中间插入 `/` 时不能把光标后的正文当成 filter（否则列表被滤空）
    const caret = mentionEditorRef.current?.getCaretPlainTextOffset() ?? null;
    return extractSlashInlineQuery(plainText, caret);
    // slashOpenRef 变化不触发 render；依赖 plainText + open 以在打开后刷新 query
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slashOpenRef is a ref
  }, [plainText, open, mentionEditorRef]);

  const mode = slashOpenRef.current ? 'slash' : 'toolbar';

  const close = useCallback(() => {
    slashOpenRef.current = false;
    setOpen(false);
  }, [setOpen, slashOpenRef]);

  const toggleToolbar = useCallback(() => {
    mentionEditorRef.current?.saveCaret();
    toggleToolbarFromMutex();
  }, [mentionEditorRef, toggleToolbarFromMutex]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !pickerRef.current?.contains(target)
        && !buttonRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [open, setOpen]);

  const handleTextInput = useCallback(
    (text: string) => {
      if (text !== '/' || open || isComposingRef.current) {
        return;
      }

      closeOthers?.();
      setSkillPickerOpen(false);
      setQuickInputPickerOpen(false);
      slashOpenRef.current = true;
      setOpen(true);
    },
    [
      closeOthers,
      isComposingRef,
      open,
      setOpen,
      setQuickInputPickerOpen,
      setSkillPickerOpen,
      slashOpenRef,
    ],
  );

  /** 仅 slash 自动关；不负责 setComposerSnapshot */
  const onSnapshotChange = useCallback(
    (snapshot: MentionComposerSnapshot) => {
      if (
        slashOpenRef.current
        && open
        && !snapshot.plainText.includes('/')
      ) {
        slashOpenRef.current = false;
        setOpen(false);
      }
    },
    [open, setOpen, slashOpenRef],
  );

  const handleSelect = useCallback(
    (id: string, name: string) => {
      const shouldConsumeSlash = slashOpenRef.current;
      slashOpenRef.current = false;
      setOpen(false);
      let insertAt: number | undefined;
      if (shouldConsumeSlash) {
        const offset = mentionEditorRef.current?.consumeSlashTrigger(query);
        if (typeof offset === 'number') insertAt = offset;
      }
      onClearPendingWorkflow?.();
      mentionEditorRef.current?.insertWorkflow(id, name, 'mine', insertAt);
      mentionEditorRef.current?.focus();
    },
    [mentionEditorRef, onClearPendingWorkflow, query, setOpen, slashOpenRef],
  );

  const handleSelectSkill = useCallback(
    ({ slug, title }: { slug: string; title: string }) => {
      const shouldConsumeSlash = slashOpenRef.current;
      slashOpenRef.current = false;
      setOpen(false);
      let insertAt: number | undefined;
      if (shouldConsumeSlash) {
        const offset = mentionEditorRef.current?.consumeSlashTrigger(query);
        if (typeof offset === 'number') insertAt = offset;
      }
      mentionEditorRef.current?.insertSkill(slug, title, insertAt);
      mentionEditorRef.current?.focus();
    },
    [mentionEditorRef, query, setOpen, slashOpenRef],
  );

  const panelProps: WorkflowPickerPanelProps = {
    open,
    mode,
    query,
    anchorRef: buttonRef,
    composerRef: composerShellRef,
    onClose: close,
    onSelect: handleSelect,
    onSelectSkill: handleSelectSkill,
  };

  return {
    open,
    buttonRef: buttonRef as MutableRefObject<HTMLButtonElement | null>,
    pickerRef: pickerRef as MutableRefObject<HTMLDivElement | null>,
    toggleToolbar,
    close,
    handleTextInput,
    onSnapshotChange,
    panelProps,
  };
}
