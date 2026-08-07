export type { DingTalkMention } from '../../shared/dingtalk-send/dingtalk-mention';
import type { DingTalkMention } from '../../shared/dingtalk-send/dingtalk-mention';

export interface MentionSearchItem {
  type: 'user' | 'group';
  id: string;
  title: string;
  subtitle?: string | null;
  avatar?: string | null;
  corpId?: string | null;
}

export function mentionSearchItemToMention(item: MentionSearchItem): DingTalkMention {
  if (item.type === 'user') {
    return {
      type: 'user',
      displayName: item.title,
      userId: item.id,
      corpId: item.corpId ?? undefined,
    };
  }
  return {
    type: 'group',
    displayName: item.title,
    openConversationId: item.id,
    corpId: item.corpId ?? undefined,
  };
}
