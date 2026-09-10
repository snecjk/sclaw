import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { IMMessage, IMMessageGroupReadReceipt, IMMessageReadStatus } from '../types';

function resolveReadStatusLabel(
  status: IMMessageReadStatus,
  groupReadReceipt: IMMessageGroupReadReceipt | undefined,
  isGroup: boolean,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (status === 'sending') {
    return t('im.messageSending');
  }

  // Group member-level receipts need OpenIM enterprise SDK.
  // Open-source builds never get hasReadCount updates — don't show fake「未读」.
  if (isGroup) {
    if (groupReadReceipt && groupReadReceipt.readCount > 0) {
      if (
        groupReadReceipt.memberCount > 1
        && groupReadReceipt.readCount >= groupReadReceipt.memberCount
      ) {
        return t('im.messageRead');
      }
      return t('im.messageGroupReadCount', {
        count: groupReadReceipt.readCount,
      });
    }
    return t('im.messageSent');
  }

  if (status === 'read') {
    return t('im.messageRead');
  }

  return t('im.messageUnread');
}

function isUnreadLabel(
  status: IMMessageReadStatus,
  groupReadReceipt: IMMessageGroupReadReceipt | undefined,
  isGroup: boolean,
): boolean {
  if (status === 'sending') return false;
  if (isGroup) {
    // 「已发送」/「N人已读」 are not unread emphasis.
    return false;
  }
  if (groupReadReceipt && groupReadReceipt.memberCount > 1) {
    return groupReadReceipt.readCount <= 0;
  }
  return status !== 'read';
}

export function ImMessageReadStatus({
  readStatus,
  groupReadReceipt,
  isGroup = false,
  align = 'end',
}: {
  readStatus?: IMMessageReadStatus;
  groupReadReceipt?: IMMessageGroupReadReceipt;
  isGroup?: boolean;
  align?: 'start' | 'end';
}) {
  const { t } = useTranslation('common');

  if (!readStatus) return null;

  const label = resolveReadStatusLabel(readStatus, groupReadReceipt, isGroup, t);
  const unread = isUnreadLabel(readStatus, groupReadReceipt, isGroup);

  return (
    <div
      className={cn(
        'mt-1 text-[11px] leading-4',
        unread
          ? 'text-[#3370FF] dark:text-sky-400'
          : 'text-[var(--sto-text-tertiary)]',
        align === 'end' ? 'text-right' : 'text-left',
      )}
      aria-label={label}
    >
      {label}
    </div>
  );
}

export function shouldShowMessageReadStatus(message: IMMessage): boolean {
  return message.role === 'self' && Boolean(message.readStatus);
}
