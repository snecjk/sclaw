import { describe, expect, it } from 'vitest';
import {
  dedupeRecentMentionRows,
  extractConversationRows,
  extractListAllPagination,
  mapListAllConversationItem,
  mapUnreadConversationItem,
} from '../../shared/dingtalk-recent-mentions';

describe('dingtalk recent mentions', () => {
  it('maps list-all single chat as user and group as group', () => {
    const rows = [
      {
        singleChat: true,
        title: '李峥',
        openConversationId: 'cid-single',
      },
      {
        singleChat: false,
        title: '申声不息群',
        openConversationId: 'cid-group',
        unreadPoint: 32,
      },
    ];

    expect(mapListAllConversationItem(rows[0])).toEqual({
      type: 'user',
      id: '',
      title: '李峥',
      subtitle: '单聊',
    });
    expect(mapListAllConversationItem(rows[1])).toEqual({
      type: 'group',
      id: 'cid-group',
      title: '申声不息群',
      subtitle: '32人',
    });
  });

  it('extracts conversationMessagesList from list-all payload', () => {
    const payload = {
      result: {
        conversationMessagesList: [{ title: 'A', openConversationId: '1', singleChat: false }],
        hasMore: true,
        nextCursor: 'cursor-2',
      },
    };
    expect(extractConversationRows(payload)).toHaveLength(1);
    expect(extractListAllPagination(payload)).toEqual({
      hasMore: true,
      nextCursor: 'cursor-2',
    });
  });

  it('maps unread conversation single chat as user', () => {
    expect(mapUnreadConversationItem({
      singleChat: true,
      title: '张三',
      openConversationId: 'cid-1',
    })).toEqual({
      type: 'user',
      id: '',
      title: '张三',
      subtitle: '单聊',
    });
  });

  it('dedupes rows by type and id/title', () => {
    const rows = dedupeRecentMentionRows([
      { type: 'group', id: 'g1', title: '群A' },
      { type: 'group', id: 'g1', title: '群A' },
      { type: 'user', id: '', title: '李峥', subtitle: '单聊' },
      { type: 'user', id: '', title: '李峥', subtitle: '单聊' },
    ]);
    expect(rows).toHaveLength(2);
  });
});
