import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { DingTalkSentRecipientKind } from '../../../shared/dingtalk-sent-display';

/** 与输入框 @ 标签一致的配色（见 dingtalk-mention-composer MENTION_SPAN_BASE_CLASS）。 */
export const dingTalkMentionTagClassName = [
  'inline rounded-[3px] px-0.5',
  'bg-[#E8F3FF] text-[#1677FF] font-medium',
  'dark:bg-[#1677FF]/15 dark:text-[#4C9BFF]',
].join(' ');

interface DingTalkMentionTagProps {
  name: string;
  kind?: DingTalkSentRecipientKind | 'user' | 'group';
  className?: string;
}

export function DingTalkMentionTag({ name, kind = 'user', className }: DingTalkMentionTagProps) {
  const label = kind === 'group' ? name : `@${name}`;
  return (
    <span className={cn(dingTalkMentionTagClassName, className)}>
      {label}
    </span>
  );
}

const USER_MENTION_PATTERN = /(@[^\s@\n]+)/g;

/** 将用户消息中的 @提及 渲染为与输入框一致的标签样式。 */
export function renderUserMessageMentionNodes(text: string): ReactNode[] {
  const parts = text.split(USER_MENTION_PATTERN);
  return parts.map((part, index) => {
    if (!part.startsWith('@')) {
      return part;
    }
    const name = part.slice(1);
    if (!name) return part;
    return <DingTalkMentionTag key={`mention-${index}-${name}`} name={name} kind="user" />;
  });
}
