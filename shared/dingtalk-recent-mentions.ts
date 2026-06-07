/**
 * 最近 @ 提及列表：从 dws list-unread-conversations 响应映射为 MentionSearchItem 形状。
 */

export interface RecentMentionRow {
  type: 'user' | 'group';
  id: string;
  title: string;
  subtitle?: string | null;
}

export function formatDwsDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function recentMentionWindow(days = 30): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return { start: formatDwsDateTime(start), end: formatDwsDateTime(end) };
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/** dws 未读会话项里的未读条数字段（常见为 unreadPoint）。 */
export function pickUnreadCount(record: Record<string, unknown>): number | null {
  for (const key of ['unreadCount', 'unreadNum', 'unreadMessageCount', 'unreadPoint', 'redPoint', 'unReadCount']) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.trunc(value);
    }
  }
  return null;
}

export function formatUnreadSubtitle(unreadCount: number | null, kind: 'user' | 'group'): string {
  if (unreadCount !== null) return `${unreadCount} 条未读`;
  return kind === 'user' ? '单聊' : '群聊';
}

/** 从 dws JSON 中提取会话行（list-all / unread / top）。 */
export function extractConversationRows(value: unknown): unknown[] {
  if (!value || typeof value !== 'object') return [];
  const root = value as Record<string, unknown>;
  const result = root.result;
  if (result && typeof result === 'object') {
    const nested = result as Record<string, unknown>;
    if (Array.isArray(nested.conversationMessagesList)) {
      return nested.conversationMessagesList;
    }
    if (Array.isArray(nested.conversations)) {
      return nested.conversations;
    }
  }

  if (Array.isArray(value)) return value;
  for (const key of ['items', 'users', 'groups', 'conversations', 'list', 'results', 'data']) {
    if (Array.isArray(root[key])) return root[key] as unknown[];
  }
  if (Array.isArray(result)) return result;
  return [];
}

export function extractListAllPagination(value: unknown): {
  hasMore: boolean;
  nextCursor: string | null;
} {
  if (!value || typeof value !== 'object') {
    return { hasMore: false, nextCursor: null };
  }
  const result = (value as Record<string, unknown>).result;
  if (!result || typeof result !== 'object') {
    return { hasMore: false, nextCursor: null };
  }
  const nested = result as Record<string, unknown>;
  const hasMore = nested.hasMore === true;
  const nextCursor = typeof nested.nextCursor === 'string' && nested.nextCursor.trim()
    ? nested.nextCursor.trim()
    : null;
  return { hasMore, nextCursor };
}

export function mapListAllConversationItem(raw: unknown): RecentMentionRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const openConversationId = pickString(record, ['openConversationId', 'conversationId', 'cid']);
  const title = pickString(record, ['title', 'name', 'conversationName', 'groupName', 'nick']);
  if (!openConversationId || !title) return null;

  if (record.singleChat === true) {
    const userId = pickString(record, ['userId', 'peerUserId', 'userOpenId', 'openDingtalkId', 'openDingTalkId']);
    return {
      type: 'user',
      id: userId ?? '',
      title,
      subtitle: '单聊',
    };
  }

  const memberCount = record.memberCount ?? record.userCount ?? record.unreadPoint;
  const subtitle = typeof memberCount === 'number' && memberCount > 0
    ? `${memberCount}人`
    : '群聊';
  return {
    type: 'group',
    id: openConversationId,
    title,
    subtitle,
  };
}

export function mapUnreadConversationItem(raw: unknown): RecentMentionRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const openConversationId = pickString(record, ['openConversationId', 'conversationId', 'cid']);
  const title = pickString(record, ['title', 'name', 'conversationName', 'groupName', 'nick']);
  if (!openConversationId || !title) return null;

  const unreadCount = pickUnreadCount(record);

  if (record.singleChat === true) {
    const userId = pickString(record, ['userId', 'peerUserId', 'userOpenId', 'openDingtalkId', 'openDingTalkId']);
    return {
      type: 'user',
      id: userId ?? '',
      title,
      subtitle: formatUnreadSubtitle(unreadCount, 'user'),
    };
  }

  return {
    type: 'group',
    id: openConversationId,
    title,
    subtitle: formatUnreadSubtitle(unreadCount, 'group'),
  };
}

export function dedupeRecentMentionRows(rows: RecentMentionRow[]): RecentMentionRow[] {
  const seen = new Set<string>();
  const merged: RecentMentionRow[] = [];
  for (const row of rows) {
    const key = `${row.type}:${row.id || row.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  return merged;
}
