/**
 * 发送 / 停止 / 排队发送按钮（经 Shell `toolbarRight` 注入）。
 * `sending && canSend` →「再发一条入队」样式；否则发送或停止。
 *
 * ## Types
 * - `InputComposerSendButtonProps` — layout、sending/canSend/canStop、onSend/onStop、title 文案
 */
import { ArrowUp, SendHorizontal, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { InputComposerShellLayout } from './input-composer-shell';

/** 发送按钮 UI 与交互状态 */
export interface InputComposerSendButtonProps {
  /** 视觉布局：首页 / 对话页（影响尺寸与图标） */
  layout?: InputComposerShellLayout;
  /** 是否正在发送（显示停止或入队样式） */
  sending?: boolean;
  /** 是否可发送（有内容且附件就绪等） */
  canSend?: boolean;
  /** 发送中时是否允许停止 */
  canStop?: boolean;
  /** 点击发送 / 入队 */
  onSend: () => void;
  /** 点击停止生成 */
  onStop?: () => void;
  /** 发送按钮 title */
  sendTitle: string;
  /** 停止按钮 title */
  stopTitle: string;
}

export function InputComposerSendButton({
  layout = 'home',
  sending = false,
  canSend = false,
  canStop = false,
  onSend,
  onStop,
  sendTitle,
  stopTitle,
}: InputComposerSendButtonProps) {
  const isHome = layout === 'home';
  const sizeClass = isHome
    ? 'h-[30px] w-[30px] shrink-0 rounded-[16px]'
    : 'h-9 w-9 shrink-0 rounded-full';
  const SendIcon = isHome ? ArrowUp : SendHorizontal;

  if (sending && canSend) {
    return (
      <Button
        onClick={onSend}
        size="icon"
        className={cn(
          sizeClass,
          'border border-primary/80 bg-primary text-primary-foreground shadow-[var(--sto-shadow-brand-action)] hover:bg-primary/90',
        )}
        variant="ghost"
        title={sendTitle}
      >
        <SendIcon className="h-4 w-4" strokeWidth={2.1} aria-hidden />
      </Button>
    );
  }

  return (
    <Button
      onClick={sending ? onStop : onSend}
      disabled={sending ? !canStop : !canSend}
      size="icon"
      className={cn(
        sizeClass,
        'border transition-all',
        sending
          ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800 dark:border-white/80 dark:bg-white/80 dark:text-slate-900 dark:hover:bg-white/90'
          : canSend
            ? 'border-primary/80 bg-primary text-primary-foreground shadow-[var(--sto-shadow-brand-action)] hover:bg-primary/90'
            : 'border-black/8 bg-black/5 text-muted-foreground/55 dark:border-white/10 dark:bg-white/[0.06]',
      )}
      variant="ghost"
      title={sending ? stopTitle : sendTitle}
    >
      {sending ? (
        <Square className="h-3.5 w-3.5" fill="currentColor" aria-hidden />
      ) : (
        <SendIcon className="h-4 w-4" strokeWidth={2.1} aria-hidden />
      )}
    </Button>
  );
}
