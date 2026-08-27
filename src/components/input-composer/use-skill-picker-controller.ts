/**
 * 技能 picker 控制器：inline（`$` 触发）/ toolbar 双模式、定位、选中插入。
 * open/mode 由 mutex 持有，本 hook 不再声明独立 open state。
 *
 * ## Types
 * - `SkillPickerMode` — `'inline'` | `'toolbar'`
 * - `UseSkillPickerControllerOptions` — open/mode、mutex toggle、editor/plainText、popover host
 * - 返回值含 `panelProps`（可直接铺给 SkillPickerPanel）
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
  type RefObject,
} from 'react';
import { useNavigate } from 'react-router-dom';
import type { DingTalkMentionEditorHandle } from '@/components/dingtalk/DingTalkMentionEditor';
import type { SkillPickerProps } from '@/components/skill-plaza/SkillPicker';
import { extractSkillInlineQuery } from '@/lib/dingtalk-mention-composer';
import { useSkillPlazaStore } from '@/stores/skill-plaza';

/** 技能面板打开来源：行内触发 vs 工具栏按钮 */
export type SkillPickerMode = 'inline' | 'toolbar';

/** 控制器选项；`mentionPopoverHostRef` 用于 inline 点击外部判断 */
export interface UseSkillPickerControllerOptions {
  /** 面板是否打开（由 mutex 持有） */
  open: boolean;
  /** 设置打开态；支持函数式更新 */
  setOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  /** 打开来源：行内 `$` vs 工具栏按钮 */
  mode: SkillPickerMode;
  /** 更新 mode（mutex 侧；controller 内可暂不用） */
  setMode: (mode: SkillPickerMode) => void;
  /** mutex 提供的工具栏互斥 toggle */
  toggleToolbarFromMutex: () => void;
  /** MentionEditor 句柄（插技能 / 消费行内触发） */
  mentionEditorRef: RefObject<DingTalkMentionEditorHandle | null>;
  /** 当前纯文本，用于提取 inline query */
  plainText: string;
  /** 定位 host（inline 点击外部判断） */
  mentionPopoverHostRef: RefObject<HTMLElement | null>;
  /** 收起工具栏时共用触发钮 ref */
  toolbarAnchorRef?: RefObject<HTMLButtonElement | null>;
}

export function useSkillPickerController({
  open,
  setOpen,
  mode,
  setMode: _setMode,
  toggleToolbarFromMutex,
  mentionEditorRef,
  plainText,
  mentionPopoverHostRef,
  toolbarAnchorRef,
}: UseSkillPickerControllerOptions) {
  void _setMode;
  const navigate = useNavigate();
  const internalButtonRef = useRef<HTMLButtonElement>(null);
  const buttonRef = toolbarAnchorRef ?? internalButtonRef;
  const pickerRef = useRef<HTMLDivElement>(null);

  const inlineQuery = useMemo(() => {
    if (mode !== 'inline') return '';
    const caret = mentionEditorRef.current?.getCaretPlainTextOffset() ?? null;
    return extractSkillInlineQuery(plainText, caret);
  }, [mode, plainText, mentionEditorRef]);

  const close = useCallback(() => {
    if (mode === 'inline') {
      mentionEditorRef.current?.consumeSkillInlineTrigger();
    }
    setOpen(false);
  }, [mentionEditorRef, mode, setOpen]);

  const toggleToolbar = useCallback(() => {
    mentionEditorRef.current?.saveCaret();
    toggleToolbarFromMutex();
  }, [mentionEditorRef, toggleToolbarFromMutex]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (pickerRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      if (mode === 'inline' && mentionPopoverHostRef.current?.contains(target)) return;

      if (mode === 'inline') {
        mentionEditorRef.current?.consumeSkillInlineTrigger();
      }
      setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [mentionEditorRef, mentionPopoverHostRef, mode, open, setOpen]);

  const handleSelect = useCallback(
    ({ slug, title }: { slug: string; title: string }) => {
      setOpen(false);
      let insertAt: number | undefined;
      if (mode === 'inline') {
        const offset = mentionEditorRef.current?.consumeSkillInlineTrigger(inlineQuery);
        if (typeof offset === 'number') insertAt = offset;
      }
      mentionEditorRef.current?.insertSkill(slug, title, insertAt);
      mentionEditorRef.current?.focus();
    },
    [inlineQuery, mentionEditorRef, mode, setOpen],
  );

  const handleAddMore = useCallback(() => {
    useSkillPlazaStore.setState({ activeTab: 'all', activeCategory: '', searchQuery: '' });
    setOpen(false);
    navigate('/skills');
  }, [navigate, setOpen]);

  const panelProps: SkillPickerProps = {
    open,
    mode,
    query: inlineQuery,
    // 工具栏：portal + fixed 锚定按钮，避免 Task 描述框 overflow 裁切
    // 行内 `$`：不传 anchor，仍相对 host absolute（Chat host 为 overflow-visible）
    anchorRef: mode === 'toolbar' ? buttonRef : undefined,
    onSelect: handleSelect,
    onClose: close,
    onAddMore: handleAddMore,
  };

  return {
    open,
    mode,
    buttonRef: buttonRef as MutableRefObject<HTMLButtonElement | null>,
    pickerRef: pickerRef as MutableRefObject<HTMLDivElement | null>,
    toggleToolbar,
    close,
    panelProps,
  };
}
