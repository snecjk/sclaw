/**
 * ChatProcessLoadingEllipsis — 思考/工具正文加载中的「...」动效
 *
 * 紧跟在打字机或快照正文之后，表示当前块仍在写入。
 */
import { cn } from '@/lib/utils';
import { chatProcessLoadingTextClass } from '@/lib/surfaces';

export interface ChatProcessLoadingEllipsisProps {
  className?: string;
}

export function ChatProcessLoadingEllipsis({ className }: ChatProcessLoadingEllipsisProps) {
  return (
    <span
      className={cn('chat-process-loading-ellipsis inline-flex', chatProcessLoadingTextClass, className)}
      aria-hidden
    >
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
}
