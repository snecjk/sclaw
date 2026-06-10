export interface DingTalkMention {
  type: 'user' | 'group';
  displayName: string;
  userId?: string;
  openConversationId?: string;
  corpId?: string;
}

export const DINGTALK_RECIPIENTS_MARKER = '[STOCLAW:DINGTALK_RECIPIENTS:v1]';

export function hasResolvedDingTalkMentions(mentions?: DingTalkMention[]): boolean {
  if (!mentions?.length) return false;
  return mentions.every((mention) => {
    if (mention.type === 'user') return !!mention.userId?.trim();
    return !!mention.openConversationId?.trim();
  });
}
