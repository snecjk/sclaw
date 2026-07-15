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
  insertSkillSpan,
  insertPlainTextAtCaret,
  insertWorkflowSpan,
  consumeSkillTriggerText,
  MENTION_SPAN_SELECTOR,
  removeMentionBeforeCaret,
  removeMentionSpan,
  removeSkillSpan,
  readSkillMetaFromEditorRoot,
  serializeMentionEditor,
  setMentionEditorMentions,
  setMentionEditorPlainText,
  type ActiveMentionTrigger,
  type MentionComposerSnapshot,
} from '@/lib/dingtalk-mention-composer';
import { resolveSkillFromPlaza } from '@/lib/skill-plaza-resolve';

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
  insertWorkflow: (workflowId: string, name: string, source?: string) => void;
  insertSkill: (slug: string, title: string) => void;
  consumeSkillInlineTrigger: (query?: string) => boolean;
  removeSkill: () => void;
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

    const resizeEditor = useCallback(() => {
      const root = editorRef.current;
      if (!root) return;
      root.style.height = 'auto';
      root.style.height = `${Math.min(root.scrollHeight, 200)}px`;
    }, []);

    useImperativeHandle(ref, () => ({
      focus: () => editorRef.current?.focus(),
      clear: () => {
        const root = editorRef.current;
        if (!root) return;
        clearMentionEditor(root);
        resizeEditor();
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
        resizeEditor();
        syncFromDom();
      },
      insertPlainText: (text) => {
        const root = editorRef.current;
        if (!root) return;
        insertPlainTextAtCaret(root, text);
        resizeEditor();
        syncFromDom(false);
      },
      setMentions: (mentions) => {
        const root = editorRef.current;
        if (!root) return;
        setMentionEditorMentions(root, mentions, { removable: removableMentions });
        resizeEditor();
        syncFromDom(false);
      },
      insertMention: (mention, trigger) => {
        const root = editorRef.current;
        if (!root) return;
        insertMentionAtTrigger(root, trigger, mention, { removable: removableMentions });
        resizeEditor();
        syncFromDom();
        onTriggerChange?.(null);
      },
      insertWorkflow: (workflowId, name, source) => {
        const root = editorRef.current;
        if (!root) return;
        insertWorkflowSpan(root, workflowId, name, source);
        resizeEditor();
        syncFromDom();
      },
      insertSkill: (slug, title) => {
        const root = editorRef.current;
        if (!root) return;
        insertSkillSpan(root, slug, title);
        resizeEditor();
        syncFromDom();
      },
      consumeSkillInlineTrigger: (query) => {
        const root = editorRef.current;
        if (!root) return false;
        const consumed = consumeSkillTriggerText(root, query);
        if (consumed) {
          resizeEditor();
          syncFromDom();
        }
        return consumed;
      },
      removeSkill: () => {
        const root = editorRef.current;
        if (!root) return;
        removeSkillSpan(root);
        resizeEditor();
        syncFromDom();
      },
      openMentionPicker: () => {
        const root = editorRef.current;
        if (!root) return;
        insertAtTriggerCharacter(root);
        resizeEditor();
        syncFromDom();
        onTriggerChange?.(detectActiveMentionTrigger(root));
      },
    }), [onTriggerChange, removableMentions, resizeEditor, syncFromDom]);

    useEffect(() => {
      resizeEditor();
    }, [resizeEditor]);

    useEffect(() => {
      const trimmed = seedText?.trim();
      const root = editorRef.current;
      if (!root) return;

      if (trimmed) {
        if (lastAppliedSeedRef.current === trimmed) return;
        lastAppliedSeedRef.current = trimmed;
        setMentionEditorPlainText(root, `${trimmed} `);
        focusEditorAtEnd(root);
        resizeEditor();
        syncFromDom();
        return;
      }

      lastAppliedSeedRef.current = undefined;
    }, [resizeEditor, seedText, syncFromDom]);

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
      const { title } = resolveSkillFromPlaza(slug);
      insertSkillSpan(root, slug, title);
      resizeEditor();
      syncFromDom();
    }, [resizeEditor, seedSkillSlug, syncFromDom]);

    const handleInput = useCallback(() => {
      resizeEditor();
      syncFromDom();
    }, [resizeEditor, syncFromDom]);

    const handleMentionRemove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-mention-remove]')) return;

      event.preventDefault();
      event.stopPropagation();

      const root = editorRef.current;
      const span = target.closest(MENTION_SPAN_SELECTOR);
      if (!root || !(span instanceof HTMLSpanElement)) return;

      removeMentionSpan(root, span);
      resizeEditor();
      syncFromDom();
      root.focus();
    }, [resizeEditor, syncFromDom]);

    const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Backspace' && !isComposingRef.current) {
        const root = editorRef.current;
        if (root && removeMentionBeforeCaret(root)) {
          event.preventDefault();
          resizeEditor();
          syncFromDom();
          return;
        }
      }
      onKeyDown?.(event);
    }, [onKeyDown, resizeEditor, syncFromDom]);

    const handleKeyUp = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
      syncFromDom();
      onKeyUp?.(event);
    }, [onKeyUp, syncFromDom]);

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
        onClick={() => syncFromDom()}
        onCompositionStart={() => {
          isComposingRef.current = true;
          onCompositionStart?.();
        }}
        onCompositionUpdate={() => {
          resizeEditor();
          syncFromDom();
        }}
        onCompositionEnd={() => {
          isComposingRef.current = false;
          onCompositionEnd?.();
          resizeEditor();
          syncFromDom();
        }}
      />
    );
  },
);
