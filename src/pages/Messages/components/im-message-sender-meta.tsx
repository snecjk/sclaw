import { cn } from '@/lib/utils';
import { formatImMessageClock } from './format-im-message-time';
import type { IMConversation, IMMessage } from '../types';

export function ImMessageSenderMeta({
  message,
  conversation,
  selfLabel,
  align = 'start',
}: {
  message: IMMessage;
  conversation: IMConversation;
  selfLabel: string;
  align?: 'start' | 'end';
}) {
  if (message.role === 'system') return null;

  const showGroupMeta = conversation.type === 'group';
  const showSingleMeta = conversation.type === 'single' && message.role === 'self';
  if (!showGroupMeta && !showSingleMeta) return null;
  if (!message.time) return null;

  const senderName = message.role === 'self'
    ? selfLabel
    : (message.senderName ?? conversation.name);
  const clock = formatImMessageClock(message.time);

  return (
    <div
      className={cn(
        'mb-1 flex items-center gap-2 text-[11px] leading-4 text-[var(--sto-text-tertiary)]',
        align === 'end' ? 'justify-end' : 'justify-start',
      )}
    >
      <span>{clock}</span>
      <span className="max-w-[10rem] truncate text-[var(--sto-text-secondary)]">{senderName}</span>
    </div>
  );
}
