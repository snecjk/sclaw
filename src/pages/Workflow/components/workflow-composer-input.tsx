/**
 * WorkflowComposerInput - 工作流列表页专用输入框
 *
 * 与首页共用 DingTalkMentionEditor + 同款圆角壳层样式，
 * 但底部无工具栏（附件 / @提及 / Agent / Workflow 按钮），仅保留右下角发送箭头。
 * 使用位置：src/pages/Workflow/components/workflow-composer.tsx
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  chatComposerHomeShellClass,
  chatComposerHomeShellDragOverClass,
  chatComposerHomeShellIdleClass,
} from '@/lib/surfaces';
import {
  DingTalkMentionEditor,
  type DingTalkMentionEditorHandle,
} from '@/components/dingtalk/DingTalkMentionEditor';
import { Button } from '@/components/ui/button';
import type { MentionComposerSnapshot } from '@/lib/dingtalk-mention-composer';
import type { DingTalkMention } from '@/types/dingtalk-mention';

export interface WorkflowComposerInputProps {
  onSend: (
    text: string,
    dingTalkMentions?: DingTalkMention[],
  ) => void;
  disabled?: boolean;
  placeholder?: string;
  seedText?: string;
  className?: string;
}

export function WorkflowComposerInput({
  onSend,
  disabled = false,
  placeholder,
  seedText,
  className,
}: WorkflowComposerInputProps) {
  const { t } = useTranslation('chat');
  const editorRef = useRef<DingTalkMentionEditorHandle>(null);
  const isComposingRef = useRef(false);
  const [composerSnapshot, setComposerSnapshot] = useState<MentionComposerSnapshot>({
    plainText: '',
    mentions: [],
    isEmpty: true,
  });
  const [dragOver, setDragOver] = useState(false);

  const canSend = !composerSnapshot.isEmpty && composerSnapshot.plainText.trim().length > 0 && !disabled;

  // Focus editor on mount
  useEffect(() => {
    if (!disabled) {
      editorRef.current?.focus();
    }
  }, [disabled]);

  // Apply seedText when it changes
  useEffect(() => {
    if (!seedText) return;
    editorRef.current?.setPlainText(seedText);
    editorRef.current?.focus();
  }, [seedText]);

  const handleSend = useCallback(() => {
    if (!canSend) return;
    const snapshot = editorRef.current?.getSnapshot() ?? composerSnapshot;
    const textToSend = snapshot.plainText.trim();
    const mentionsToSend = snapshot.mentions.length > 0 ? snapshot.mentions : undefined;
    editorRef.current?.clear();
    onSend(textToSend, mentionsToSend);
  }, [canSend, composerSnapshot, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const nativeEvent = e.nativeEvent as KeyboardEvent;
        if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
          return;
        }
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Drag & drop — visual feedback only (actual file staging not needed for workflow)
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  return (
    <div className={cn('w-full', className)}>
      <div
        className={cn(
          chatComposerHomeShellClass,
          dragOver ? chatComposerHomeShellDragOverClass : chatComposerHomeShellIdleClass,
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {/* 编辑区：pr-10 防文字与发送按钮重叠 */}
        <div className="flex min-h-0 flex-1 flex-col pr-10 pb-2 pl-4 pt-3">
          <DingTalkMentionEditor
            ref={editorRef}
            placeholder={placeholder ?? t('composer.messagePlaceholder', { agent: '' })}
            disabled={disabled}
            seedText={seedText}
            onSnapshotChange={setComposerSnapshot}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
          />
        </div>

        {/* 发送箭头：绝对定位右下角 */}
        <Button
          onClick={handleSend}
          disabled={!canSend}
          size="icon"
          className={cn(
            'absolute bottom-2 right-3 h-[30px] w-[30px] shrink-0 rounded-[16px] border transition-all',
            canSend
              ? 'border-primary/80 bg-primary text-primary-foreground shadow-[0_6px_16px_rgba(255,111,0,0.22)] hover:bg-primary/90'
              : 'border-black/8 bg-black/5 text-muted-foreground/55 dark:border-white/10 dark:bg-white/[0.06]',
          )}
          variant="ghost"
          title={t('composer.send')}
        >
          <ArrowUp className="h-4 w-4" strokeWidth={2.1} aria-hidden />
        </Button>
      </div>
    </div>
  );
}
