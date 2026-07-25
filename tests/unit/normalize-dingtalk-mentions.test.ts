import { describe, expect, it } from 'vitest';
import { normalizeDingTalkMentions } from '../../shared/dingtalk-send/dingtalk-mention';

describe('normalizeDingTalkMentions', () => {
  it('keeps resolved user and group mentions', () => {
    expect(
      normalizeDingTalkMentions([
        { type: 'user', displayName: '张三', userId: 'u1', corpId: 'c1' },
        { type: 'group', displayName: '研发群', openConversationId: 'cid-1' },
      ]),
    ).toEqual([
      { type: 'user', displayName: '张三', userId: 'u1', corpId: 'c1' },
      { type: 'group', displayName: '研发群', openConversationId: 'cid-1' },
    ]);
  });

  it('drops unresolved or invalid entries', () => {
    expect(
      normalizeDingTalkMentions([
        { type: 'user', displayName: '无 id' },
        { type: 'group', displayName: '无群 id' },
        null,
        'bad',
      ]),
    ).toEqual([]);
  });

  it('returns empty array for non-array input', () => {
    expect(normalizeDingTalkMentions(undefined)).toEqual([]);
    expect(normalizeDingTalkMentions({ recipients: [] })).toEqual([]);
  });
});
