import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { cn } from '@/lib/utils';
import type { DingTalkMention } from '@/types/dingtalk-mention';
import {
  clearMentionEditor,
  detectActiveMentionTrigger,
  insertMentionAtTrigger,
  removeMentionBeforeCaret,
  serializeMentionEditor,
  setMentionEditorPlainText,
  type ActiveMentionTrigger,
  type MentionComposerSnapshot,
} from '@/lib/dingtalk-mention-composer';

export interface DingTalkMentionEditorHandle {
  focus: () => void;
  clear: () => void;
  getSnapshot: () => MentionComposerSnapshot;
  insertMention: (mention: DingTalkMention, trigger: ActiveMentionTrigger) => void;
}

interface DingTalkMentionEditorProps {
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onSnapshotChange?: (snapshot: MentionComposerSnapshot) => void;
  onTriggerChange?: (trigger: ActiveMentionTrigger | null) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onPaste?: (event: React.ClipboardEvent<HTMLDivElement>) => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  seedText?: string;
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
      onPaste,
      onCompositionStart,
      onCompositionEnd,
      seedText,
    },
    ref,
  ) {
    const editorRef = useRef<HTMLDivElement>(null);
    const seedAppliedRef = useRef(false);
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
      insertMention: (mention, trigger) => {
        const root = editorRef.current;
        if (!root) return;
        insertMentionAtTrigger(root, trigger, mention);
        resizeEditor();
        syncFromDom();
        onTriggerChange?.(null);
      },
    }), [onTriggerChange, resizeEditor, syncFromDom]);

    useEffect(() => {
      const trimmed = seedText?.trim();
      const root = editorRef.current;
      if (!root) return;

      if (trimmed) {
        if (seedAppliedRef.current) return;
        seedAppliedRef.current = true;
        setMentionEditorPlainText(root, trimmed);
        resizeEditor();
        syncFromDom();
        return;
      }

      if (seedAppliedRef.current) {
        seedAppliedRef.current = false;
        clearMentionEditor(root);
        resizeEditor();
        syncFromDom();
      }
    }, [resizeEditor, seedText, syncFromDom]);

    const handleInput = useCallback(() => {
      resizeEditor();
      syncFromDom();
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
        onPaste={onPaste}
        onClick={syncFromDom}
        onKeyUp={syncFromDom}
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
        }}
      />
    );
  },
);
