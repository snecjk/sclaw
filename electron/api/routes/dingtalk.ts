/**
 * DingTalk dws host-api routes — mention search and status.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import {
  dwsAuthStatus,
  dwsCheckInstalled,
  installOrUpdateDwsCli,
  runDws,
} from '../../utils/dws-cli';
import { promptGatewayRestartAfterDwsInstall } from '../../utils/dws-install-notify';
import { fetchDingTalkAvatar } from '../../utils/dingtalk-avatar';
import { getSetting } from '../../utils/store';
import {
  dedupeRecentMentionRows,
  extractConversationRows,
  extractListAllPagination,
  mapListAllConversationItem,
  mapUnreadConversationItem,
  sortConversationsByLastMsg,
  type RecentMentionRow,
} from '../../../shared/dingtalk-recent-mentions';

interface MentionSearchRequest {
  query?: string;
  limit?: number;
  cursor?: string;
  types?: Array<'user' | 'conversation' | 'group'>;
}

interface MentionSearchItem {
  type: 'user' | 'group';
  id: string;
  title: string;
  subtitle?: string | null;
  avatar?: string | null;
  corpId?: string | null;
}

const RECENT_MENTION_PAGE_SIZE = 10;
const DWS_STATUS_CACHE_TTL_MS = 180_000;

type DwsInstalledStatus = Awaited<ReturnType<typeof dwsCheckInstalled>>;

let installedStatusCache: { value: DwsInstalledStatus; expiresAt: number } | null = null;
let authStatusCache: { value: boolean; expiresAt: number } | null = null;

function invalidateDwsStatusCache(): void {
  installedStatusCache = null;
  authStatusCache = null;
}

async function getCachedDwsInstalled(): Promise<DwsInstalledStatus> {
  const now = Date.now();
  if (installedStatusCache && installedStatusCache.expiresAt > now) {
    return installedStatusCache.value;
  }
  const value = await dwsCheckInstalled();
  installedStatusCache = { value, expiresAt: now + DWS_STATUS_CACHE_TTL_MS };
  return value;
}

async function getCachedDwsAuthenticated(): Promise<boolean> {
  const now = Date.now();
  if (authStatusCache && authStatusCache.expiresAt > now) {
    return authStatusCache.value;
  }
  const value = await isDwsAuthenticated();
  authStatusCache = { value, expiresAt: now + DWS_STATUS_CACHE_TTL_MS };
  return value;
}

function extractDwsRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];

  const obj = value as Record<string, unknown>;
  for (const key of ['items', 'users', 'groups', 'conversations', 'list', 'results', 'data']) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }

  const result = obj.result;
  if (Array.isArray(result)) return result;
  if (result && typeof result === 'object') {
    const nested = result as Record<string, unknown>;
    for (const key of ['users', 'groups', 'conversations', 'items', 'list']) {
      if (Array.isArray(nested[key])) return nested[key] as unknown[];
    }
  }

  return [];
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function resolvePublicAvatarUrl(record: Record<string, unknown>): string | null {
  const avatar = pickString(record, ['avatar', 'avatarUrl']);
  if (avatar && /^https?:\/\//i.test(avatar)) return avatar;
  // aisearch 的 authorAvatar / sourceIcon 是钉钉内部 mediaId（@lQLP...），
  // dws 目前没有「按 mediaId 下载头像」的 CLI，无法在外部 WebView 中直接展示。
  return null;
}

function buildUserSubtitle(position?: string | null, dept?: string | null): string | null {
  const parts = [position?.trim(), dept?.trim()].filter((value): value is string => !!value);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function mapUserItem(raw: unknown): MentionSearchItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = pickString(record, ['userId', 'userid', 'id', 'uid']);
  const title = pickString(record, ['name', 'nick', 'displayName', 'userName']);
  const position = pickString(record, ['title', 'position', 'orgTitle', 'jobTitle']);
  if (!id || !title) return null;
  return {
    type: 'user',
    id,
    title,
    subtitle: buildUserSubtitle(
      position,
      pickString(record, ['deptName', 'department', 'orgName']),
    ),
    avatar: resolvePublicAvatarUrl(record),
    corpId: pickString(record, ['corpId', 'corp_id']) ?? null,
  };
}

function mapAisearchPersonItem(raw: unknown): MentionSearchItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = pickString(record, ['userId', 'userid', 'id']);
  const title = pickString(record, ['title', 'author']);
  if (!id || !title) return null;

  const meta = record.meta;
  const metaRecord = meta && typeof meta === 'object' ? meta as Record<string, unknown> : null;
  const position = pickString(metaRecord ?? {}, ['position'])
    ?? pickString(record, ['snippet']);
  return {
    type: 'user',
    id,
    title,
    subtitle: buildUserSubtitle(position, null),
    avatar: resolvePublicAvatarUrl(record),
    corpId: pickString(record, ['corpId', 'corp_id']) ?? null,
  };
}

function mapGroupItem(raw: unknown): MentionSearchItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = pickString(record, [
    'openConversationId',
    'conversationId',
    'cid',
    'chatId',
    'id',
  ]);
  const title = pickString(record, ['title', 'name', 'conversationName', 'groupName']);
  if (!id || !title) return null;
  const memberCount = record.memberCount ?? record.userCount ?? record.count;
  const subtitle = typeof memberCount === 'number'
    ? `${memberCount}人`
    : pickString(record, ['subtitle']) ?? null;
  return {
    type: 'group',
    id,
    title,
    subtitle,
    avatar: resolvePublicAvatarUrl(record),
    corpId: pickString(record, ['corpId', 'corp_id']) ?? null,
  };
}

function mapConversationItem(raw: unknown): MentionSearchItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const openConversationId = pickString(record, ['openConversationId', 'conversationId', 'cid']);
  const title = pickString(record, ['title', 'name', 'conversationName', 'groupName', 'nick']);
  if (!openConversationId || !title) return null;

  const singleChat = record.singleChat === true;
  const userId = pickString(record, ['userId', 'userOpenId', 'openDingtalkId', 'openDingTalkId']);
  if (singleChat && userId) {
    return {
      type: 'user',
      id: userId,
      title,
      subtitle: pickString(record, ['subtitle', 'title']) ?? '单聊',
      avatar: resolvePublicAvatarUrl(record),
      corpId: pickString(record, ['corpId', 'corp_id']) ?? null,
    };
  }

  const memberCount = record.memberCount ?? record.userCount ?? record.unreadPoint;
  const subtitle = singleChat
    ? '单聊'
    : typeof memberCount === 'number'
      ? `${memberCount}人`
      : pickString(record, ['subtitle']) ?? null;

  return {
    type: 'group',
    id: openConversationId,
    title,
    subtitle,
    avatar: resolvePublicAvatarUrl(record),
    corpId: pickString(record, ['corpId', 'corp_id']) ?? null,
  };
}

function matchesMentionQuery(title: string, query: string): boolean {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return true;
  return title.toLowerCase().includes(keyword);
}

/** 从「公司-姓名」里取短名，用于名称命中判断。 */
function personDisplayName(title: string): string {
  const idx = title.lastIndexOf('-');
  if (idx >= 0 && idx < title.length - 1) {
    const shortName = title.slice(idx + 1).trim();
    if (shortName) return shortName;
  }
  return title;
}

/** 名称命中：全称或短名包含关键字（不含岗位/部门副标题）。 */
function matchesMentionUserName(item: MentionSearchItem, query: string): boolean {
  if (matchesMentionQuery(item.title, query)) return true;
  return matchesMentionQuery(personDisplayName(item.title), query);
}

/** 联系人：姓名或部门/职位副标题须包含关键字（与群名过滤一致）。 */
function matchesMentionUserQuery(item: MentionSearchItem, query: string): boolean {
  if (matchesMentionUserName(item, query)) return true;
  if (item.subtitle && matchesMentionQuery(item.subtitle, query)) return true;
  return false;
}

/** 含拉丁字母时视为拼音检索，aisearch 结果不过滤。 */
function isLatinMentionQuery(query: string): boolean {
  return /[a-zA-Z]/.test(query);
}

async function searchUsersViaAisearch(query: string, limit: number): Promise<MentionSearchItem[]> {
  const result = await runDws(
    ['aisearch', 'person', '--keyword', query, '--dimension', 'name', '--format', 'json'],
    8_000,
  );
  if (!result.ok) return [];
  const rows = extractDwsRows(result.data);
  const mapped = rows
    .map(mapAisearchPersonItem)
    .filter((item): item is MentionSearchItem => item !== null);
  // 中文词（如「财务」）aisearch 也会按岗位召回；非拼音时只保留名称命中
  const filtered = isLatinMentionQuery(query)
    ? mapped
    : mapped.filter((item) => matchesMentionUserName(item, query));
  return filtered.slice(0, limit);
}

async function searchUsersViaContact(query: string, limit: number): Promise<MentionSearchItem[]> {
  const result = await runDws(
    ['contact', 'user', 'search', '--query', query, '--format', 'json'],
    8_000,
  );
  if (!result.ok) return [];
  const rows = extractDwsRows(result.data);
  return rows
    .map(mapUserItem)
    .filter((item): item is MentionSearchItem => item !== null)
    .slice(0, limit);
}

/**
 * 三路结果统一去重排序：
 * contact 名称命中 → 群 → aisearch（垫底，含拼音）。
 * contact 仅岗位/副标题命中不参与，避免「财务」岗刷屏。
 */
function mergeMentionSearchResults(
  contactItems: MentionSearchItem[],
  groupItems: MentionSearchItem[],
  aisearchItems: MentionSearchItem[],
  query: string,
  limit: number,
): MentionSearchItem[] {
  const contactNameMatched = contactItems.filter((item) => matchesMentionUserName(item, query));
  const seen = new Set<string>();
  const items: MentionSearchItem[] = [];
  for (const item of [...contactNameMatched, ...groupItems, ...aisearchItems]) {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= limit) break;
  }
  return items;
}

async function enrichUserDetails(items: MentionSearchItem[]): Promise<MentionSearchItem[]> {
  const userIds = items.filter((item) => item.type === 'user').map((item) => item.id);
  if (userIds.length === 0) return items;

  const result = await runDws(
    ['contact', 'user', 'get', '--ids', userIds.join(','), '--format', 'json'],
    8_000,
  );
  if (!result.ok) return items;

  const detailByUserId = new Map<string, { position?: string; dept?: string }>();
  for (const raw of extractDwsRows(result.data)) {
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as Record<string, unknown>;
    const model = record.orgEmployeeModel;
    if (!model || typeof model !== 'object') continue;
    const org = model as Record<string, unknown>;
    const userId = pickString(org, ['orgUserId']);
    if (!userId) continue;
    const depts = org.depts;
    const deptName = Array.isArray(depts) && depts[0] && typeof depts[0] === 'object'
      ? pickString(depts[0] as Record<string, unknown>, ['deptName'])
      : undefined;
    detailByUserId.set(userId, {
      position: pickString(org, ['orgTitle']),
      dept: deptName,
    });
  }

  return items.map((item) => {
    if (item.type !== 'user') return item;
    const detail = detailByUserId.get(item.id);
    if (!detail) return item;
    const position = detail.position ?? item.subtitle?.split(' · ')[0] ?? null;
    return {
      ...item,
      subtitle: buildUserSubtitle(position, detail.dept) ?? item.subtitle,
    };
  });
}

async function searchConversations(query: string, limit: number): Promise<MentionSearchItem[]> {
  const result = await runDws(
    ['chat', 'search', '--keyword', query, '--format', 'json', '--limit', String(Math.max(limit, 20))],
    8_000,
  );
  if (!result.ok) return [];
  const rows = extractDwsRows(result.data);
  return rows
    .map((row) => mapGroupItem(row) ?? mapConversationItem(row))
    .filter((item): item is MentionSearchItem => item !== null)
    .filter((item) => matchesMentionQuery(item.title, query))
    .slice(0, limit);
}

function toMentionSearchItem(row: RecentMentionRow): MentionSearchItem {
  return {
    type: row.type,
    id: row.id,
    title: row.title,
    subtitle: row.subtitle ?? null,
    avatar: null,
    corpId: null,
  };
}

async function enrichRecentSingleChatUsers(items: MentionSearchItem[]): Promise<MentionSearchItem[]> {
  const enriched = await Promise.all(items.map(async (item) => {
    if (item.type !== 'user' || item.id.trim()) return item;
    const resolved = await searchUsersViaContact(item.title, 1);
    const match = resolved[0];
    if (!match?.id) return item;
    return {
      ...item,
      id: match.id,
      subtitle: match.subtitle ?? '单聊',
      avatar: match.avatar ?? null,
      corpId: match.corpId ?? null,
    };
  }));
  return enriched.filter((item) => item.type !== 'user' || !!item.id.trim());
}

async function listRecentMentionsFromListAll(
  limit: number,
  cursor?: string,
): Promise<{ items: MentionSearchItem[]; hasMore: boolean; nextCursor: string | null } | null> {
  const args = [
    'chat', 'list-all-conversations',
    '--limit', String(Math.min(Math.max(limit, 1), 100)),
    '--format', 'json',
  ];
  const trimmedCursor = cursor?.trim();
  if (trimmedCursor) {
    args.push('--cursor', trimmedCursor);
  }

  const result = await runDws(args, 8_000);
  if (!result.ok) return null;

  const sortedRows = sortConversationsByLastMsg(extractConversationRows(result.data));
  const mapped = dedupeRecentMentionRows(
    sortedRows
      .map(mapListAllConversationItem)
      .filter((item): item is RecentMentionRow => item !== null),
  );
  const items = await enrichRecentSingleChatUsers(mapped.map(toMentionSearchItem));
  const pagination = extractListAllPagination(result.data);
  return {
    items,
    hasMore: pagination.hasMore,
    nextCursor: pagination.nextCursor,
  };
}

async function listRecentMentionsFromUnread(
  limit: number,
  cursor?: string,
): Promise<{ items: MentionSearchItem[]; hasMore: boolean; nextCursor: string | null }> {
  const offset = Math.max(0, Number.parseInt(cursor?.trim() || '0', 10) || 0);
  const fetchCount = offset + limit + 1;
  const result = await runDws([
    'chat', 'message', 'list-unread-conversations',
    '--count', String(fetchCount),
    '--format', 'json',
  ], 8_000);
  if (!result.ok) {
    return { items: [], hasMore: false, nextCursor: null };
  }

  const allRows = dedupeRecentMentionRows(
    extractConversationRows(result.data)
      .map(mapUnreadConversationItem)
      .filter((item): item is RecentMentionRow => item !== null),
  );
  const pageRows = allRows.slice(offset, offset + limit);
  const hasMore = allRows.length > offset + limit;
  const items = await enrichRecentSingleChatUsers(pageRows.map(toMentionSearchItem));
  return {
    items,
    hasMore,
    nextCursor: hasMore ? String(offset + limit) : null,
  };
}

/** 优先最近会话（list-all）；旧版 dws 无该命令时回退未读会话。 */
async function listRecentMentions(
  limit: number,
  cursor?: string,
): Promise<{ items: MentionSearchItem[]; hasMore: boolean; nextCursor: string | null }> {
  const fromListAll = await listRecentMentionsFromListAll(limit, cursor);
  if (fromListAll) return fromListAll;
  return listRecentMentionsFromUnread(limit, cursor);
}

async function isDwsAuthenticated(): Promise<boolean> {
  const result = await dwsAuthStatus();
  if (!result.ok) return false;
  if (typeof result.data === 'object' && result.data !== null) {
    const data = result.data as Record<string, unknown>;
    if (typeof data.authenticated === 'boolean') return data.authenticated;
    if (typeof data.loggedIn === 'boolean') return data.loggedIn;
    if (typeof data.userId === 'string' && data.userId) return true;
    if (typeof data.name === 'string' && data.name) return true;
  }
  return true;
}

export async function handleDingTalkRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (getSetting('dingTalkDwsEnabled') === false) {
    if (url.pathname.startsWith('/api/dingtalk/')) {
      sendJson(res, 503, {
        error: 'DingTalk dws integration is disabled',
        needsInstall: false,
        needsAuth: false,
      });
      return true;
    }
    return false;
  }

  if (url.pathname === '/api/dingtalk/auth/login' && req.method === 'POST') {
    const parentWindow = _ctx.mainWindow;
    if (!parentWindow || parentWindow.isDestroyed()) {
      sendJson(res, 503, { success: false, error: 'Main window unavailable' });
      return true;
    }

    const installed = await getCachedDwsInstalled();
    if (!installed.installed) {
      sendJson(res, 503, { success: false, error: 'dws is not installed', needsInstall: true });
      return true;
    }

    try {
      const { dwsAuthLogin } = await import('../../utils/dws-cli');
      const result = await dwsAuthLogin(parentWindow);
      if (!result.ok) {
        sendJson(res, 500, { success: false, error: result.error || 'DingTalk login failed' });
        return true;
      }
      invalidateDwsStatusCache();
      const authenticated = await getCachedDwsAuthenticated();
      sendJson(res, 200, { success: true, authenticated });
      return true;
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
      return true;
    }
  }

  if (url.pathname === '/api/dingtalk/install' && req.method === 'POST') {
    try {
      const result = await installOrUpdateDwsCli((path) => {
        if (_ctx.mainWindow && !_ctx.mainWindow.isDestroyed()) {
          _ctx.mainWindow.webContents.send('dws:cli-installed', path);
        }
      });
      if (!result.success) {
        sendJson(res, 500, {
          success: false,
          error: result.error ?? 'dws install failed',
        });
        return true;
      }
      invalidateDwsStatusCache();
      await promptGatewayRestartAfterDwsInstall(_ctx.gatewayManager, _ctx.mainWindow, result);
      sendJson(res, 200, {
        success: true,
        path: result.path ?? null,
        version: result.version ?? null,
        updated: result.updated ?? false,
      });
      return true;
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
      return true;
    }
  }

  if (url.pathname === '/api/dingtalk/status' && req.method === 'GET') {
    const installed = await getCachedDwsInstalled();
    const authenticated = installed.installed ? await getCachedDwsAuthenticated() : false;
    sendJson(res, 200, {
      installed: installed.installed,
      version: installed.version ?? null,
      binaryPath: installed.path ?? null,
      authenticated,
      skillMode: installed.skillMode ?? null,
    });
    return true;
  }

  if (url.pathname === '/api/dingtalk/mention-search' && req.method === 'POST') {
    const body = await parseJsonBody<MentionSearchRequest>(req);
    const query = (body.query ?? '').trim();
    const limit = Math.min(Math.max(body.limit ?? 20, 1), 50);
    const types = body.types?.length
      ? body.types.map((t) => (t === 'group' ? 'conversation' : t))
      : ['user', 'conversation'];

    const installed = await getCachedDwsInstalled();
    if (!installed.installed) {
      sendJson(res, 200, { items: [], needsInstall: true, needsAuth: false });
      return true;
    }

    const authenticated = await getCachedDwsAuthenticated();
    if (!authenticated) {
      sendJson(res, 200, { items: [], needsInstall: false, needsAuth: true });
      return true;
    }

    if (!query) {
      const recentLimit = Math.min(limit, RECENT_MENTION_PAGE_SIZE);
      const { items, hasMore, nextCursor } = await listRecentMentions(recentLimit, body.cursor);
      sendJson(res, 200, { items, recent: true, hasMore, nextCursor });
      return true;
    }

    const wantUsers = types.includes('user');
    const wantGroups = types.includes('conversation');
    // 拼音/拉丁检索：aisearch 已覆盖人名，跳过 contact + chat 以减少 dws 进程
    const latinQuery = isLatinMentionQuery(query);
    const [fromContact, fromGroups, fromAisearch] = await Promise.all([
      wantUsers && !latinQuery ? searchUsersViaContact(query, limit) : Promise.resolve([]),
      // chat search keyword 较宽松，结果在 searchConversations 内按 title 二次过滤
      wantGroups && !latinQuery ? searchConversations(query, limit) : Promise.resolve([]),
      wantUsers ? searchUsersViaAisearch(query, limit) : Promise.resolve([]),
    ]);

    const merged = mergeMentionSearchResults(
      fromContact,
      fromGroups,
      fromAisearch,
      query,
      limit,
    );
    const items = await enrichUserDetails(merged);

    sendJson(res, 200, { items });
    return true;
  }

  if (url.pathname === '/api/dingtalk/avatar' && req.method === 'GET') {
    const mediaId = url.searchParams.get('mediaId')?.trim() ?? '';
    if (!mediaId) {
      sendJson(res, 400, { error: 'mediaId is required' });
      return true;
    }

    const avatar = await fetchDingTalkAvatar(mediaId);
    if (!avatar) {
      res.statusCode = 404;
      res.end();
      return true;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', avatar.contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(avatar.body);
    return true;
  }

  return false;
}
