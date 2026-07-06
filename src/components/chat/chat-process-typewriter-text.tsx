/**
 * ChatProcessTypewriterText — 思考/工具参数区打字机正文（仅活跃块）
 *
 * 流式期用 pre-wrap 纯文本；活跃块正文末尾可附「...」加载动效。
 */
import { cn } from '@/lib/utils';
import { useTypewriterReveal } from '@/hooks/use-typewriter-reveal';
import { chatProcessBlockBodyClass } from '@/components/chat/chat-process-block';
import { ChatProcessLoadingEllipsis } from '@/components/chat/chat-process-loading-ellipsis';

export interface ChatProcessTypewriterTextProps {
  /** 目标全文（Gateway 快照） */
  text: string;
  /** true = 当前活跃块，启用打字机 */
  isActive: boolean;
  /** 块 identity，切换块时重置打字进度 */
  resetKey: string;
  /** 活跃块正文末尾展示「...」加载动效 */
  showLoadingEllipsis?: boolean;
  className?: string;
  /** pre 用于 JSON；p 用于思考正文 */
  as?: 'pre' | 'p';
}

export function ChatProcessTypewriterText({
  text,
  isActive,
  resetKey,
  showLoadingEllipsis = false,
  className,
  as = 'pre',
}: ChatProcessTypewriterTextProps) {
  const { text: displayed, isAnimating } = useTypewriterReveal(text, isActive, { resetKey });

  const Comp = as;
  const showEllipsis = showLoadingEllipsis && isActive;

  return (
    <Comp
      className={cn(className ?? chatProcessBlockBodyClass, 'whitespace-pre-wrap')}
      aria-busy={isActive || isAnimating ? true : undefined}
    >
      {displayed}
      {showEllipsis ? <ChatProcessLoadingEllipsis /> : null}
    </Comp>
  );
}
