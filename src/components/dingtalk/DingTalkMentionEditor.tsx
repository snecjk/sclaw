import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { cn } from '@/lib/utils';
import type { DingTalkMention } from '@/types/dingtalk-mention';
import type { SkillMeta } from '@/types/skill-meta';
import {
  clearMentionEditor,
  detectActiveMentionTrigger,
  insertAtTriggerCharacter,
  insertMentionAtTrigger,
  insertSaiInterfaceSpan,
  insertSkillSpan,
  insertPlainTextAtCaret,
  insertWorkflowSpan,
  consumeSkillTriggerText,
  consumeSlashTriggerText,
  readCaretPlainTextOffset,
  MENTION_SPAN_SELECTOR,
  removeMentionBeforeCaret,
  removeMentionSpan,
  removeSkillSpan,
  retitleSkillSpan,
  readSkillMetaFromEditorRoot,
  serializeMentionEditor,
  setMentionEditorMentions,
  setMentionEditorPlainText,
  type ActiveMentionTrigger,
  type MentionComposerSnapshot,
} from '@/lib/dingtalk-mention-composer';
import { resolveSkillFromPlaza, resolveSkillPrompt } from '@/lib/skill-plaza-resolve';

function focusEditorAtEnd(root: HTMLElement): void {
  root.focus();

  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  const lastChild = root.lastChild;
  if (lastChild?.nodeType === Node.TEXT_NODE) {
    range.setStart(lastChild, lastChild.textContent?.length ?? 0);
  } else {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export interface DingTalkMentionEditorHandle {
  focus: () => void;
  clear: () => void;
  getSnapshot: () => MentionComposerSnapshot;
  readSkillMeta: () => SkillMeta | undefined;
  setPlainText: (text: string) => void;
  insertPlainText: (text: string) => void;
  setMentions: (mentions: DingTalkMention[]) => void;
  insertMention: (mention: DingTalkMention, trigger: ActiveMentionTrigger) => void;
  insertWorkflow: (workflowId: string, name: string, source?: string, plainTextOffset?: number) => void;
  insertSkill: (slug: string, title: string, plainTextOffset?: number) => void;
  /** 在光标处插入 sai-cli 接口 chip（中文高亮，可多次） */
  insertSaiInterface: (path: string, name: string) => void;
  /** 打开浮层前保存光标，避免点击列表后插入跑到末尾 */
  rememberCaret: () => void;
  /** @returns 触发符原位置下标；未消费时返回 null */
  consumeSkillInlineTrigger: (query?: string) => number | null;
  /** @returns `/` 原位置下标；未消费时返回 null */
  consumeSlashTrigger: (query?: string) => number | null;
  removeSkill: () => void;
  /** 记录当前光标位置，供工具栏/浮层选中后恢复插入点 */
  saveCaret: () => void;
  /** 插入 `@` 并打开钉钉 mention 选择（与手动输入 `@` 等价） */
  openMentionPicker: () => void;
}

interface DingTalkMentionEditorProps {
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onSnapshotChange?: (snapshot: MentionComposerSnapshot) => void;
  onTriggerChange?: (trigger: ActiveMentionTrigger | null) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onKeyUp?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onTextInput?: (text: string) => void;
  onPaste?: (event: React.ClipboardEvent<HTMLDivElement>) => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  seedText?: string;
  /** 技能广场「使用」：预填技能标签（仅 title 可见） */
  seedSkillSlug?: string;
  /** 为 @ 标签显示删除按钮（用于定时任务发送对象等场景） */
  removableMentions?: boolean;
}

export const DingTalkMentionEditor = forwardRef<DingTalkMentionEditorHandle, DingTalkMentionEditorProps>(
  function DingTalkMentionEditor(
    {
      placeholder,
      disabled = false,
      className,
      onSnapshotChange,
      onTriggerChange,
      onKeyDown,
      onKeyUp,
      onTextInput,
      onPaste,
      onCompositionStart,
      onCompositionEnd,
      seedText,
      seedSkillSlug,
      removableMentions = false,
    },
    ref,
  ) {
    const editorRef = useRef<HTMLDivElement>(null);
    const appliedSkillSeedRef = useRef<string | undefined>(undefined);
    const lastAppliedSeedRef = useRef<string | undefined>(undefined);
    const isComposingRef = useRef(false);
    const lastCaretOffsetRef = useRef<number | null>(null);
    const lastCaretRangeRef = useRef<Range | null>(null);

    const captureCaretOffset = useCallback(() => {
      const root = editorRef.current;
      if (!root) return;
      const offset = readCaretPlainTextOffset(root);
      if (offset !== null) {
        lastCaretOffsetRef.current = offset;
      }
    }, []);

    const rememberCaret = useCallback(() => {
      const root = editorRef.current;
      const selection = window.getSelection();
      if (!root || !selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return;
      lastCaretRangeRef.current = range.cloneRange();
    }, []);

    const resolveInsertOffset = useCallback((explicitOffset?: number): number | undefined => {
      if (explicitOffset !== undefined) return explicitOffset;
      const root = editorRef.current;
      if (!root) return lastCaretOffsetRef.current ?? undefined;
      const live = readCaretPlainTextOffset(root);
      if (live !== null) return live;
      return lastCaretOffsetRef.current ?? undefined;
    }, []);

    const syncTriggerRafRef = useRef<number | null>(null);

    const syncFromDom = useCallback((syncTrigger = true) => {
      const root = editorRef.current;
      if (!root) return;
      const snapshot = serializeMentionEditor(root);
      onSnapshotChange?.(snapshot);
      if (!syncTrigger) return;

      if (syncTriggerRafRef.current !== null) {
        cancelAnimationFrame(syncTriggerRafRef.current);
      }
      syncTriggerRafRef.current = requestAnimationFrame(() => {
        syncTriggerRafRef.current = null;
        const current = editorRef.current;
        if (!current) return;
        onTriggerChange?.(detectActiveMentionTrigger(current));
      });
    }, [onSnapshotChange, onTriggerChange]);

    useImperativeHandle(ref, () => ({
      focus: () => editorRef.current?.focus(),
      clear: () => {
        const root = editorRef.current;
        if (!root) return;
        clearMentionEditor(root);
        lastCaretRangeRef.current = null;
        syncFromDom();
      },
      getSnapshot: () => {
        const root = editorRef.current;
        if (!root) return { plainText: '', mentions: [], isEmpty: true };
        return serializeMentionEditor(root);
      },
      readSkillMeta: () => {
        const root = editorRef.current;
        if (!root) return undefined;
        return readSkillMetaFromEditorRoot(root);
      },
      setPlainText: (text) => {
        const root = editorRef.current;
        if (!root) return;
        lastAppliedSeedRef.current = undefined;
        setMentionEditorPlainText(root, text);
        syncFromDom();
      },
      insertPlainText: (text) => {
        const root = editorRef.current;
        if (!root) return;
        insertPlainTextAtCaret(root, text);
        syncFromDom(false);
      },
      setMentions: (mentions) => {
        const root = editorRef.current;
        if (!root) return;
        setMentionEditorMentions(root, mentions, { removable: removableMentions });
        syncFromDom(false);
      },
      insertMention: (mention, trigger) => {
        const root = editorRef.current;
        if (!root) return;
        insertMentionAtTrigger(root, trigger, mention, { removable: removableMentions });
        syncFromDom();
        onTriggerChange?.(null);
      },
      insertWorkflow: (workflowId, name, source, plainTextOffset) => {
        const root = editorRef.current;
        if (!root) return;
        insertWorkflowSpan(root, workflowId, name, source, resolveInsertOffset(plainTextOffset));
        syncFromDom();
        captureCaretOffset();
      },
      insertSkill: (slug, title, plainTextOffset) => {
        const root = editorRef.current;
        if (!root) return;
        insertSkillSpan(root, slug, title, resolveInsertOffset(plainTextOffset));
        syncFromDom();
        captureCaretOffset();
        rememberCaret();
      },
      insertSaiInterface: (path, name) => {
        const root = editorRef.current;
        if (!root) return;
        insertSaiInterfaceSpan(root, path, name, lastCaretRangeRef.current);
        rememberCaret();
        syncFromDom(false);
        captureCaretOffset();
      },
      rememberCaret,
      consumeSkillInlineTrigger: (query) => {
        const root = editorRef.current;
        if (!root) return null;
        const offset = consumeSkillTriggerText(root, query);
        if (offset !== null) {
          syncFromDom();
        }
        return offset;
      },
      consumeSlashTrigger: (query) => {
        const root = editorRef.current;
        if (!root) return null;
        const offset = consumeSlashTriggerText(root, query);
        if (offset !== null) {
          syncFromDom();
        }
        return offset;
      },
      removeSkill: () => {
        const root = editorRef.current;
        if (!root) return;
        removeSkillSpan(root);
        syncFromDom();
      },
      saveCaret: () => {
        captureCaretOffset();
      },
      openMentionPicker: () => {
        const root = editorRef.current;
        if (!root) return;
        insertAtTriggerCharacter(root);
        rememberCaret();
        syncFromDom();
        onTriggerChange?.(detectActiveMentionTrigger(root));
      },
    }), [captureCaretOffset, onTriggerChange, rememberCaret, removableMentions, resolveInsertOffset, syncFromDom]);

    useEffect(() => {
      const onSelectionChange = () => {
        captureCaretOffset();
      };
      document.addEventListener('selectionchange', onSelectionChange);
      return () => document.removeEventListener('selectionchange', onSelectionChange);
    }, [captureCaretOffset]);

    useEffect(() => {
      const trimmed = seedText?.trim();
      const root = editorRef.current;
      if (!root) return;

      if (trimmed) {
        if (lastAppliedSeedRef.current === trimmed) return;
        lastAppliedSeedRef.current = trimmed;
        setMentionEditorPlainText(root, `${trimmed} `);
        focusEditorAtEnd(root);
        syncFromDom();
        return;
      }

      lastAppliedSeedRef.current = undefined;
    }, [seedText, syncFromDom]);

    useEffect(() => {
      const slug = seedSkillSlug?.trim();
      const root = editorRef.current;
      if (!root) return;

      if (!slug) {
        appliedSkillSeedRef.current = undefined;
        return;
      }

      if (appliedSkillSeedRef.current === slug) return;
      appliedSkillSeedRef.current = slug;
      insertSkillSpan(root, slug, resolveSkillFromPlaza(slug).title);
      syncFromDom();

      // A cold plaza cache renders the slug; swap in the real name once it arrives.
      let cancelled = false;
      void resolveSkillPrompt(slug).then(({ title }) => {
        const target = editorRef.current;
        if (cancelled || !target || appliedSkillSeedRef.current !== slug) return;
        if (!retitleSkillSpan(target, slug, title)) return;
        syncFromDom();
      });
      return () => {
        cancelled = true;
      };
    }, [seedSkillSlug, syncFromDom]);

    const handleInput = useCallback((event: React.FormEvent<HTMLDivElement>) => {
      const nativeEvent = event.nativeEvent as InputEvent;
      if (typeof nativeEvent.data === 'string' && nativeEvent.data.length > 0) {
        onTextInput?.(nativeEvent.data);
      }
      rememberCaret();
      syncFromDom();
      captureCaretOffset();
    }, [captureCaretOffset, onTextInput, rememberCaret, syncFromDom]);

    const handleMentionRemove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-mention-remove]')) return;

      event.preventDefault();
      event.stopPropagation();

      const root = editorRef.current;
      const span = target.closest(MENTION_SPAN_SELECTOR);
      if (!root || !(span instanceof HTMLSpanElement)) return;

      removeMentionSpan(root, span);
      syncFromDom();
      root.focus();
    }, [syncFromDom]);

    const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Backspace' && !isComposingRef.current) {
        const root = editorRef.current;
        if (root && removeMentionBeforeCaret(root)) {
          event.preventDefault();
          syncFromDom();
          return;
        }
      }
      onKeyDown?.(event);
    }, [onKeyDown, syncFromDom]);

    const handleKeyUp = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
      rememberCaret();
      syncFromDom();
      captureCaretOffset();
      onKeyUp?.(event);
    }, [captureCaretOffset, onKeyUp, rememberCaret, syncFromDom]);

    return (
      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        contentEditable={disabled ? 'false' : 'true'}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        className={cn(
          'dingtalk-mention-editor min-h-[42px] max-h-[200px] overflow-y-auto whitespace-pre-wrap break-words',
          'text-[15px] leading-6 text-foreground outline-none',
          'empty:before:text-muted-foreground/55 empty:before:content-[attr(data-placeholder)]',
          className,
        )}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onPaste={onPaste}
        onMouseDown={removableMentions ? handleMentionRemove : undefined}
        onClick={() => {
          rememberCaret();
          syncFromDom();
          captureCaretOffset();
        }}
        onBlur={rememberCaret}
        onCompositionStart={() => {
          isComposingRef.current = true;
          onCompositionStart?.();
        }}
        onCompositionUpdate={() => {
          syncFromDom();
        }}
        onCompositionEnd={() => {
          isComposingRef.current = false;
          onCompositionEnd?.();
          syncFromDom();
          captureCaretOffset();
        }}
      />
    );
  },
);
