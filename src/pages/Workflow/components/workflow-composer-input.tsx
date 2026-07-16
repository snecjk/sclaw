/**
 * WorkflowComposerInput - 工作流列表页专用输入框
 *
 * 使用普通 textarea 替代 DingTalkMentionEditor，保持同款视觉样式，
 * 但无 @提及 / 工作流引用等 contentEditable 功能，避免与参数浮层冲突。
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
import { Button } from '@/components/ui/button';

export interface WorkflowComposerInputProps {
  onSend: (text: string) => void;
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);
  const [value, setValue] = useState(() => seedText ?? '');
  const [dragOver, setDragOver] = useState(false);

  const canSend = value.trim().length > 0 && !disabled;

  // Focus textarea on mount
  useEffect(() => {
    if (!disabled) {
      textareaRef.current?.focus();
    }
  }, [disabled]);

  // Auto-resize textarea height (mirrors DingTalkMentionEditor behavior)
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [resizeTextarea, value]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
  }, []);

  const handleSend = useCallback(() => {
    if (!canSend) return;
    const textToSend = value.trim();
    setValue('');
    // Reset textarea height after clearing
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
      }
    });
    onSend(textToSend);
  }, [canSend, value, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const nativeEvent = e.nativeEvent as KeyboardEvent;
        if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
          return;
        }
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
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
          dragOver ? chatComposerHomeShellDragOverClass : chatComposerHomeShellIdleClass
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {/* 编辑区：pr-10 防文字与发送按钮重叠 */}
        <div className="flex min-h-0 flex-1 flex-col pr-10 pb-2 pl-4 pt-3">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
            placeholder={placeholder ?? t('composer.messagePlaceholder', { agent: '' })}
            disabled={disabled}
            rows={1}
            className={cn(
              // 与 DingTalkMentionEditor 同款视觉样式
              'min-h-[42px] max-h-[200px] overflow-y-auto whitespace-pre-wrap break-words',
              'text-[15px] leading-6 text-foreground outline-none',
              'resize-none bg-transparent',
              // placeholder 颜色
              'placeholder:text-muted-foreground/55',
              // disabled 样式
              disabled && 'opacity-50 cursor-not-allowed'
            )}
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
              : 'border-black/8 bg-black/5 text-muted-foreground/55 dark:border-white/10 dark:bg-white/[0.06]'
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
