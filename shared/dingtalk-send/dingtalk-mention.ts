export interface DingTalkMention {
  type: 'user' | 'group';
  displayName: string;
  userId?: string;
  openConversationId?: string;
  corpId?: string;
}

export const DINGTALK_RECIPIENTS_MARKER = '[STOCLAW:DINGTALK_RECIPIENTS:v1]';

export function hasResolvedDingTalkMentions(mentions?: DingTalkMention[] | null): boolean {
  if (!mentions?.length) return false;
  return mentions.every((mention) => {
    if (mention.type === 'user') return !!mention.userId?.trim();
    return !!mention.openConversationId?.trim();
  });
}

/**
 * 把 NL 工具 / JSON 块里的原始 recipients 收成 `DingTalkMention[]`。
 * 缺 type/id 的条目丢弃；全无效或非数组 → 空数组。
 */
export function normalizeDingTalkMentions(value: unknown): DingTalkMention[] {
  if (!Array.isArray(value)) return [];

  const result: DingTalkMention[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as Record<string, unknown>;
    const type = record.type === 'group' ? 'group' : 'user';
    const displayName =
      typeof record.displayName === 'string' ? record.displayName.trim() : '';
    if (!displayName) continue;

    const mention: DingTalkMention = { type, displayName };
    if (typeof record.userId === 'string' && record.userId.trim()) {
      mention.userId = record.userId.trim();
    }
    if (typeof record.openConversationId === 'string' && record.openConversationId.trim()) {
      mention.openConversationId = record.openConversationId.trim();
    }
    if (typeof record.corpId === 'string' && record.corpId.trim()) {
      mention.corpId = record.corpId.trim();
    }

    if (type === 'user' && !mention.userId) continue;
    if (type === 'group' && !mention.openConversationId) continue;
    result.push(mention);
  }
  return result;
}
