import { describe, expect, it } from 'vitest';
import {
  dedupeRecentMentionRows,
  extractConversationRows,
  extractListAllPagination,
  mapListAllConversationItem,
  mapUnreadConversationItem,
  pickUnreadCount,
  sortConversationsByLastMsg,
} from '../../shared/dingtalk-send/dingtalk-recent-mentions';

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
      subtitle: '群聊',
    });
  });

  it('sorts conversations by lastMsgCreateAt descending', () => {
    const sorted = sortConversationsByLastMsg([
      { title: 'old', lastMsgCreateAt: '2026-04-07T19:59:43.497+08:00' },
      { title: 'new', lastMsgCreateAt: '2026-07-10T09:29:59.981+08:00' },
      { title: 'mid', lastMsgCreateAt: '2026-06-23T12:07:20.55+08:00' },
    ]) as Array<{ title: string }>;
    expect(sorted.map((row) => row.title)).toEqual(['new', 'mid', 'old']);
  });

  it('accepts numeric nextCursor from list-all pagination', () => {
    expect(extractListAllPagination({
      result: { hasMore: true, nextCursor: 20 },
    })).toEqual({
      hasMore: true,
      nextCursor: '20',
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

  it('maps unread count from unreadPoint', () => {
    expect(pickUnreadCount({ unreadPoint: 5 })).toBe(5);
    expect(mapUnreadConversationItem({
      singleChat: false,
      title: '项目群',
      openConversationId: 'cid-group',
      unreadPoint: 5,
    })).toEqual({
      type: 'group',
      id: 'cid-group',
      title: '项目群',
      subtitle: '5 条未读',
    });
  });

  it('extracts unread conversations from result array payload', () => {
    const payload = {
      result: [{ title: 'A', openConversationId: '1', singleChat: false, unreadCount: 2 }],
    };
    expect(extractConversationRows(payload)).toHaveLength(1);
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
