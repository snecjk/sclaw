/**
 * Renderer helpers for sai-cli list / discover via unified IPC.
 *
 * 接口清单：打开时一次拉全量；前端切片分页；搜索过滤全量后再切片。
 * discover 仅作语义补充并置顶。
 */
import { invokeIpc } from '@/lib/api-client';

export type SaiCliEnvelope = {
  ok: boolean;
  data?: unknown;
  error?: string | { message?: string; code?: string };
  exitCode?: number;
};

export type SaiInterfaceCatalogItem = {
  /** CLI command path, e.g. policy.volume-biznum.query */
  path: string;
  /** Short Chinese-first label for list row */
  name: string;
  /** Full description for hover tooltip */
  description: string;
  score?: number;
};

export type SaiInterfaceCatalogPage = {
  items: SaiInterfaceCatalogItem[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
};

/** 前端列表每次多展示的条数 */
export const SAI_INTERFACE_LIST_PAGE_SIZE = 20;
const DISCOVER_LIMIT = 20;
const SHORT_TITLE_MAX = 18;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function looksLikeEnglishPath(text: string): boolean {
  return /^[a-z0-9][a-z0-9._/-]*$/i.test(text.trim());
}

function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

function envelopeErrorMessage(error: SaiCliEnvelope['error']): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && error.message) return String(error.message);
  return '';
}

/** Prefer a short Chinese title for business users.
 * 优先 commandName；否则 description，其次 summary。
 */
export function deriveInterfaceDisplayName(input: {
  path: string;
  commandName?: string;
  title?: string;
  label?: string;
  name?: string;
  description?: string;
  summary?: string;
  tags?: string[];
}): string {
  // 接口清单主标题：优先 commandName（可为中文业务名）
  const commandName = pickString(input.commandName);
  if (commandName) return commandName;

  const explicit = pickString(input.title, input.label, input.name);
  if (explicit && hasChinese(explicit) && !looksLikeEnglishPath(explicit)) {
    return explicit.length > SHORT_TITLE_MAX
      ? `${explicit.slice(0, SHORT_TITLE_MAX)}…`
      : explicit;
  }

  const description = input.description?.trim() ?? '';
  const summary = input.summary?.trim() ?? '';

  if (description && hasChinese(description) && description.length <= SHORT_TITLE_MAX) {
    return description;
  }

  const firstClause = (text: string) =>
    text.split(/[，,。；;\n]/)[0]?.trim() ?? '';

  for (const source of [description, summary]) {
    const clause = firstClause(source);
    if (!clause || !hasChinese(clause)) continue;
    if (clause.length <= SHORT_TITLE_MAX) return clause;
    return `${clause.slice(0, SHORT_TITLE_MAX)}…`;
  }

  const tag = input.tags?.find((item) => typeof item === 'string' && hasChinese(item));
  if (tag) return tag.trim();

  if (explicit && !looksLikeEnglishPath(explicit)) return explicit;

  const segment = input.path.split('.').filter(Boolean).pop() ?? input.path;
  return segment;
}

function mapCatalogRows(
  rawList: unknown[],
  options?: { preserveOrder?: boolean },
): SaiInterfaceCatalogItem[] {
  const items: SaiInterfaceCatalogItem[] = [];
  const seen = new Set<string>();

  for (const entry of rawList) {
    const row = asRecord(entry);
    if (!row) continue;
    const path = pickString(row.path, row.commandPath, row.id);
    if (!path || seen.has(path)) continue;
    seen.add(path);

    const summary = pickString(row.summary);
    const description = pickString(row.description, row.desc);
    const commandName = pickString(row.commandName, row.command_name);
    const tags = Array.isArray(row.tags)
      ? row.tags.filter((tag): tag is string => typeof tag === 'string')
      : undefined;
    const score = typeof row.score === 'number' ? row.score : undefined;

    const name = deriveInterfaceDisplayName({
      path,
      commandName,
      title: pickString(row.title, row.displayName, row.display_name),
      label: pickString(row.label),
      name: pickString(row.name),
      description,
      summary,
      tags,
    });

    items.push({
      path,
      name,
      // 列表副文案固定用 description；缺失时再回退 summary
      description: description || summary,
      score,
    });
  }

  if (!options?.preserveOrder) {
    items.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }
  return items;
}

/** Normalize sai-cli list / discover payload into a flat catalog. */
export function normalizeSaiInterfaceCatalog(payload: unknown): SaiInterfaceCatalogItem[] {
  let root: unknown = payload;
  const envelope = asRecord(payload);
  if (envelope && 'ok' in envelope && 'data' in envelope) {
    root = envelope.data;
  }

  const rootObj = asRecord(root);
  const fromDiscover = Array.isArray(rootObj?.candidates);
  const rawList = Array.isArray(root)
    ? root
    : fromDiscover
      ? (rootObj!.candidates as unknown[])
      : Array.isArray(rootObj?.commands)
        ? rootObj.commands
        : Array.isArray(rootObj?.items)
          ? rootObj.items
          : [];

  // list 分页保持接口返回顺序；discover 保持 score 顺序
  return mapCatalogRows(rawList, { preserveOrder: true });
}

export function parseSaiInterfaceCatalogPage(
  payload: unknown,
  fallback: { page: number; pageSize: number },
): SaiInterfaceCatalogPage {
  let root: unknown = payload;
  const envelope = asRecord(payload);
  if (envelope && 'ok' in envelope && 'data' in envelope) {
    root = envelope.data;
  }
  const rootObj = asRecord(root);
  const items = normalizeSaiInterfaceCatalog(root);
  const page = typeof rootObj?.page === 'number' && rootObj.page > 0
    ? Math.floor(rootObj.page)
    : fallback.page;
  const pageSize = typeof rootObj?.pageSize === 'number' && rootObj.pageSize > 0
    ? Math.floor(rootObj.pageSize)
    : fallback.pageSize;
  const total = typeof rootObj?.total === 'number' && rootObj.total >= 0
    ? Math.floor(rootObj.total)
    : page * pageSize + (items.length < pageSize ? 0 : pageSize);
  const hasMore = page * pageSize < total && items.length > 0;

  return { items, page, pageSize, total, hasMore };
}

/** list 单页（兼容旧调用）。 */
export async function fetchSaiInterfaceCatalogPage(options?: {
  page?: number;
  pageSize?: number;
}): Promise<SaiInterfaceCatalogPage> {
  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? SAI_INTERFACE_LIST_PAGE_SIZE;
  const result = await invokeIpc<SaiCliEnvelope>('sai:list', { page, pageSize });
  if (!result?.ok) {
    throw new Error(envelopeErrorMessage(result?.error) || 'sai-cli list 失败');
  }
  return parseSaiInterfaceCatalogPage(result.data ?? result, { page, pageSize });
}

/** 翻页拉全量清单（供接口清单一次加载）。 */
export async function fetchSaiInterfaceCatalogAll(): Promise<SaiInterfaceCatalogItem[]> {
  const result = await invokeIpc<SaiCliEnvelope>('sai:list', { all: true });
  if (!result?.ok) {
    throw new Error(envelopeErrorMessage(result?.error) || 'sai-cli list 失败');
  }
  return normalizeSaiInterfaceCatalog(result.data ?? result);
}

/** discover 语义搜索。 */
export async function discoverSaiInterfaces(
  query: string,
  options?: { limit?: number },
): Promise<SaiInterfaceCatalogItem[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const result = await invokeIpc<SaiCliEnvelope>('sai:discover', {
    query: trimmed,
    limit: options?.limit ?? DISCOVER_LIMIT,
  });
  if (!result?.ok) {
    throw new Error(envelopeErrorMessage(result?.error) || 'sai-cli discover 失败');
  }
  return normalizeSaiInterfaceCatalog(result.data ?? result);
}

/** 本地过滤结果优先，discover 仅补充未命中项（避免语义噪声盖住精确匹配）。 */
export function mergeCatalogLocalFirst(
  localItems: SaiInterfaceCatalogItem[],
  discoverItems: SaiInterfaceCatalogItem[],
): SaiInterfaceCatalogItem[] {
  const seen = new Set<string>();
  const out: SaiInterfaceCatalogItem[] = [];
  for (const item of [...localItems, ...discoverItems]) {
    if (!item.path || seen.has(item.path)) continue;
    seen.add(item.path);
    out.push(item);
  }
  return out;
}

/** @deprecated 使用 mergeCatalogLocalFirst；保留别名以免旧调用断裂。 */
export function mergeCatalogWithDiscoverFirst(
  discoverItems: SaiInterfaceCatalogItem[],
  listItems: SaiInterfaceCatalogItem[],
): SaiInterfaceCatalogItem[] {
  return mergeCatalogLocalFirst(listItems, discoverItems);
}

export function filterSaiInterfaceCatalog(
  items: SaiInterfaceCatalogItem[],
  query: string,
): SaiInterfaceCatalogItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const hay = `${item.path} ${item.name} ${item.description}`.toLowerCase();
    return hay.includes(q);
  });
}

/** 前端窗口切片：从全量/过滤结果中取前 visibleCount 条。 */
export function takeCatalogWindow(
  items: SaiInterfaceCatalogItem[],
  visibleCount: number,
): SaiInterfaceCatalogItem[] {
  const count = Math.max(0, Math.floor(visibleCount));
  if (count <= 0) return [];
  if (count >= items.length) return items;
  return items.slice(0, count);
}
