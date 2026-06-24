import { cn } from '@/lib/utils';
import { HomeComposer } from '@/pages/Home/HomeComposer';
import type { FileAttachment } from '@/pages/Chat/ChatInput';
import type { DingTalkMention } from '@/types/dingtalk-mention';

/**
 * 省区首页底部助手：内部统一走 HomeComposer，保持对外 props 兼容。
 */
export function HomeAssistant({
  className,
  seedText,
  onSend,
  placeholderKey,
  footerAlign = 'center',
}: {
  className?: string;
  seedText?: string;
  onSend?: (
    text: string,
    attachments?: FileAttachment[],
    targetAgentId?: string | null,
    dingTalkMentions?: DingTalkMention[],
    workflowId?: string | null,
  ) => void;
  /** i18n key under home namespace for composer placeholder override */
  placeholderKey?: string;
  /** 免责对齐（默认与总部一致居中） */
  footerAlign?: 'center' | 'right';
}) {
  return (
    <HomeComposer
      className={cn(className)}
      seedText={seedText}
      onSend={onSend}
      placeholderKey={placeholderKey}
      footerAlign={footerAlign}
    />
  );
}
