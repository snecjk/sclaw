/**
 * ChatProcessLoadingIndicator — 思考过程等待态
 *
 * @see chat-interaction-style-spec §4.6 Loading、§6.1 Shimmer
 *
 * 使用位置：ThinkingProcessPanel、ConnectingModelIndicator、AwaitingReplyIndicator。
 */
import loadingGif from '@/assets/loading.gif';
import { cn } from '@/lib/utils';
import { chatProcessBlockBodyClass } from '@/components/chat/chat-process-block';
import { chatProcessLoadingTextClass, chatToolCallShellClass } from '@/lib/surfaces';

/** 规范 §6.1：进行中 Loading 文案 shimmer */
function ChatInteractionShimmerText({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <span className={cn('chat-interaction-shimmer-text', chatProcessLoadingTextClass, className)}>
      {children}
    </span>
  );
}

/** 规范 §2.4 / §4.6：Loading 动画图标 14px 宽 */
function ChatProcessLoadingIcon({ className }: { className?: string }) {
  return (
    <img
      src={loadingGif}
      alt=""
      width={14}
      height={14}
      className={cn('h-[14px] w-[14px] shrink-0 object-contain', className)}
      aria-hidden
    />
  );
}

export interface ChatProcessLoadingIndicatorProps {
  /** 等待态文案（i18n） */
  label: string;
  className?: string;
}

/** loading.gif + shimmer 文案（思考面板内过程块间距） */
export function ChatProcessLoadingIndicator({ label, className }: ChatProcessLoadingIndicatorProps) {
  return (
    <div className={cn(chatToolCallShellClass, chatProcessBlockBodyClass, className)}>
      <div className="flex items-center gap-1.5" role="status" aria-live="polite">
        <ChatProcessLoadingIcon />
        <ChatInteractionShimmerText>{label}</ChatInteractionShimmerText>
      </div>
    </div>
  );
}

/** loading.gif + shimmer 文案（参数表单等等待场景） */
export function ChatProcessLoadingInlineIndicator({
  label,
  className,
}: ChatProcessLoadingIndicatorProps) {
  return (
    <div
      className={cn('flex items-center gap-1.5', className)}
      role="status"
      aria-live="polite"
    >
      <ChatProcessLoadingIcon />
      <ChatInteractionShimmerText>{label}</ChatInteractionShimmerText>
    </div>
  );
}
