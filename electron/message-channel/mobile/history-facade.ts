import { getKyselyDatabase } from '../../db/connection';
import { getAdapter } from '../../engines/manager';
import { getEngineSessionRegistryEntry } from '../../engines/session-registry';
import type { GatewayManager } from '../../gateway/manager';
import { logger } from '../../utils/logger';
import { getChannelGatewayManager } from '../hub/ingress';
import { parseChannelSessionKey } from '../common/session-key';

export interface HistoryListItem {
  sessionKey: string;
  title: string;
  lastActivityAt: string;
}

export interface HistoryMessageItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | null | undefined): Record<string, unknown> | null {
  if (!cursor?.trim()) return null;
  try {
    const raw = Buffer.from(cursor.trim(), 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const item = block as { type?: string; text?: string };
    if (item.type === 'text' && typeof item.text === 'string') {
      parts.push(item.text);
    } else if (typeof item.text === 'string' && !item.type) {
      parts.push(item.text);
    }
  }
  return parts.join('');
}

/**
 * mobile 历史会话列表（catalog），limit + cursor。
 */
export async function listMobileHistory(input: {
  limit?: number;
  cursor?: string | null;
}): Promise<{
  items: HistoryListItem[];
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
}> {
  const limit = Math.min(100, Math.max(1, input.limit ?? 20));
  const decoded = decodeCursor(input.cursor);
  const offset = typeof decoded?.offset === 'number' && decoded.offset >= 0
    ? Math.floor(decoded.offset)
    : 0;

  const db = getKyselyDatabase();
  const rows = await db
    .selectFrom('catalog_sessions')
    .selectAll()
    .where('channel_type', '=', 'mobile')
    .where('deleted_at', 'is', null)
    .where('session_type', '=', 'channel')
    .orderBy('last_activity_at', 'desc')
    .orderBy('session_key', 'asc')
    .limit(limit + 1)
    .offset(offset)
    .execute();

  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const items: HistoryListItem[] = page.map((row) => ({
    sessionKey: String(row.session_key),
    title: (row.title && String(row.title).trim()) || '新对话',
    lastActivityAt: String(row.last_activity_at || row.updated_at || row.created_at),
  }));

  const nextCursor = hasMore
    ? encodeCursor({ offset: offset + limit })
    : null;

  return { items, nextCursor, hasMore, limit };
}

/**
 * mobile 会话详情：仅 user/assistant 可见文本。
 */
export async function getMobileHistory(input: {
  sessionKey: string;
  limit?: number;
  cursor?: string | null;
  gatewayManager?: GatewayManager | null;
}): Promise<{
  sessionKey: string;
  messages: HistoryMessageItem[];
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
}> {
  const sessionKey = input.sessionKey.trim();
  const limit = Math.min(100, Math.max(1, input.limit ?? 50));
  const parsed = parseChannelSessionKey(sessionKey);
  if (!parsed || parsed.channelType !== 'mobile') {
    return { sessionKey, messages: [], nextCursor: null, hasMore: false, limit };
  }

  const gm = input.gatewayManager ?? getChannelGatewayManager();
  if (!gm) {
    throw new Error('gatewayManager unavailable');
  }

  const registry = await getEngineSessionRegistryEntry(sessionKey);
  let engineType: 'claude' | 'pi' = 'pi';
  if (registry?.engineType === 'claude') {
    engineType = 'claude';
  } else if (registry?.engineType === 'pi') {
    engineType = 'pi';
  } else if (registry?.engineType === 'openclaw') {
    logger.warn('[HistoryFacade] unsupported registry engineType=openclaw; using pi adapter', {
      sessionKey,
    });
    engineType = 'pi';
  }
  const adapter = getAdapter(engineType);
  // 多取一些再按 cursor 切，避免引擎无 offset
  const fetchLimit = Math.min(500, limit * 5);
  const history = await adapter.getHistory({ gatewayManager: gm }, { sessionKey, limit: fetchLimit });
  if (!history.success || !history.result) {
    logger.warn('[HistoryFacade] getHistory failed', history.error);
    return { sessionKey, messages: [], nextCursor: null, hasMore: false, limit };
  }

  const rawMessages = Array.isArray(history.result.messages)
    ? history.result.messages
    : [];

  type Norm = HistoryMessageItem;
  const normalized: Norm[] = [];
  for (let i = 0; i < rawMessages.length; i += 1) {
    const msg = rawMessages[i] as Record<string, unknown>;
    const role = msg.role === 'user' || msg.role === 'assistant' ? msg.role : null;
    if (!role) continue;
    const content = extractTextContent(msg.content ?? msg.text);
    if (!content.trim()) continue;
    const id = typeof msg.id === 'string' && msg.id
      ? msg.id
      : `idx-${i}`;
    const createdAt = typeof msg.timestamp === 'number'
      ? new Date(msg.timestamp).toISOString()
      : typeof msg.createdAt === 'string'
        ? msg.createdAt
        : new Date().toISOString();
    normalized.push({ id, role, content, createdAt });
  }

  // 时间正序
  normalized.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));

  const decoded = decodeCursor(input.cursor);
  const beforeId = typeof decoded?.beforeMessageId === 'string' ? decoded.beforeMessageId : null;

  let sliceEnd = normalized.length;
  if (beforeId) {
    const idx = normalized.findIndex((m) => m.id === beforeId);
    if (idx >= 0) sliceEnd = idx;
  }

  const start = Math.max(0, sliceEnd - limit);
  const page = normalized.slice(start, sliceEnd);
  const hasMore = start > 0;
  const oldest = page[0];
  const nextCursor = hasMore && oldest
    ? encodeCursor({ beforeMessageId: oldest.id })
    : null;

  return {
    sessionKey,
    messages: page,
    nextCursor,
    hasMore,
    limit,
  };
}

export async function handleHistoryRpc(msg: {
  type: string;
  requestId?: string;
  payload?: {
    limit?: number;
    cursor?: string | null;
    sessionKey?: string;
  };
}): Promise<void> {
  const requestId = msg.requestId?.trim();
  if (!requestId) {
    logger.warn('[HistoryFacade] missing requestId', msg.type);
    return;
  }
  const client = (await import('../hub/hub-client')).getSclawHubClient();

  try {
    if (msg.type === 'history.list') {
      const result = await listMobileHistory({
        limit: msg.payload?.limit,
        cursor: msg.payload?.cursor,
      });
      client.send({
        type: 'history.list.result',
        requestId,
        payload: result,
      });
      return;
    }
    if (msg.type === 'history.get') {
      const sessionKey = msg.payload?.sessionKey?.trim() || '';
      if (!sessionKey) {
        client.send({
          type: 'history.get.result',
          requestId,
          payload: {
            sessionKey: '',
            messages: [],
            nextCursor: null,
            hasMore: false,
            limit: msg.payload?.limit ?? 50,
            error: 'sessionKey required',
          },
        });
        return;
      }
      const result = await getMobileHistory({
        sessionKey,
        limit: msg.payload?.limit,
        cursor: msg.payload?.cursor,
      });
      client.send({
        type: 'history.get.result',
        requestId,
        payload: result,
      });
      return;
    }
  } catch (error) {
    logger.error('[HistoryFacade] rpc failed', { type: msg.type, requestId, error: String(error) });
    client.send({
      type: msg.type === 'history.list' ? 'history.list.result' : 'history.get.result',
      requestId,
      payload: {
        error: String(error),
        items: [],
        messages: [],
        nextCursor: null,
        hasMore: false,
      },
    });
  }
}
