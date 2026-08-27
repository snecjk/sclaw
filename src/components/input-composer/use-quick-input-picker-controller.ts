/**
 * 快捷输入 picker 控制器：open/toggle、点击外部关闭、选中写入编辑器。
 * open 状态由 mutex 持有，本 hook 不再声明独立 open state。
 *
 * ## Types
 * - `UseQuickInputPickerControllerOptions` — open/setOpen、mutex toggle、editor ref
 * - 返回值含 `panelProps`（可直接铺给 QuickInputPickerPanel）
 */
import {
  useCallback,
  useEffect,
  useRef,
  type MutableRefObject,
  type RefObject,
} from 'react';
import type { DingTalkMentionEditorHandle } from '@/components/dingtalk/DingTalkMentionEditor';
import type { QuickInputItem } from '@/components/quick-input/QuickInputPicker';
import type { QuickInputPickerPanelProps } from './QuickInputPickerPanel';

/** 控制器选项：open 来自 mutex */
export interface UseQuickInputPickerControllerOptions {
  /** 面板是否打开（由 mutex 持有） */
  open: boolean;
  /** 设置打开态；支持函数式更新 */
  setOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  /** mutex 提供的互斥 toggle */
  toggleFromMutex: () => void;
  /** mutex：下拉菜单打开快捷输入（只开不关） */
  openFromMutex: () => void;
  /** MentionEditor 句柄（选中后插入纯文本） */
  mentionEditorRef: RefObject<DingTalkMentionEditorHandle | null>;
  /** 收起工具栏时共用锚点 */
  toolbarAnchorRef?: RefObject<HTMLElement | null>;
}

export function useQuickInputPickerController({
  open,
  setOpen,
  toggleFromMutex,
  openFromMutex,
  mentionEditorRef,
  toolbarAnchorRef,
}: UseQuickInputPickerControllerOptions) {
  const internalButtonRef = useRef<HTMLButtonElement>(null);
  const buttonRef = toolbarAnchorRef ?? internalButtonRef;
  const pickerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
  }, [setOpen]);

  const toggle = useCallback(() => {
    toggleFromMutex();
  }, [toggleFromMutex]);

  const openToolbar = useCallback(() => {
    openFromMutex();
  }, [openFromMutex]);

  useEffect(() => {
    if (!open) return;
    const openedAt = Date.now();
    const handlePointerDown = (event: MouseEvent) => {
      if (Date.now() - openedAt < 150) return;
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

  const handleSelect = useCallback(
    (item: QuickInputItem) => {
      mentionEditorRef.current?.insertPlainText(item.content);
      mentionEditorRef.current?.focus();
    },
    [mentionEditorRef],
  );

  const panelProps: QuickInputPickerPanelProps = {
    open,
    anchorRef: buttonRef,
    onClose: close,
    onSelect: handleSelect,
  };

  return {
    open,
    buttonRef: buttonRef as MutableRefObject<HTMLButtonElement | null>,
    pickerRef: pickerRef as MutableRefObject<HTMLDivElement | null>,
    toggle,
    openToolbar,
    close,
    panelProps,
  };
}
