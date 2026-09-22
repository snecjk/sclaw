/** 数据管理列表（含 section，返回时保持 Tab） */
export const DATA_MANAGE_LIST_HREF = '/data-center?section=data_manage';

/** 数据管理 preview 嵌入页（仅数据源新建 / 编辑） */
export const DATA_MANAGE_CREATE_HREF = '/data-center/data-manage/create';

export const FINANCE_BI_PREVIEW_PAGE =
  'https://page.sto.cn/ux/sto-finance-bi-preview/index.html';

/** 所有从 SClaw 进入 preview 的入口都带这个入参 */
export const PREVIEW_EMBED_SOURCE = 'sclaw';

export type DataManagePreviewTarget =
  | { kind: 'create-owned' }
  | { kind: 'edit-owned'; editId: string };

export function buildPreviewHashUrl(
  hashPath: string,
  query: Record<string, string | undefined> = {},
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const text = String(value || '').trim();
    if (text) params.set(key, text);
  }
  params.set('source', PREVIEW_EMBED_SOURCE);
  const search = params.toString();
  return `${FINANCE_BI_PREVIEW_PAGE}#${hashPath}${search ? `?${search}` : ''}`;
}

export function buildDataManagePreviewUrl(target: DataManagePreviewTarget): string {
  if (target.kind === 'edit-owned') {
    return buildPreviewHashUrl('/data-model/datasources/create', { editId: target.editId });
  }
  return buildPreviewHashUrl('/data-model/datasources/create');
}

export function buildDataManageEmbedHref(target: DataManagePreviewTarget): string {
  const params = new URLSearchParams();
  params.set('kind', target.kind);
  if (target.kind === 'edit-owned') params.set('editId', target.editId);
  return `${DATA_MANAGE_CREATE_HREF}?${params.toString()}`;
}

export function parseDataManageEmbedSearch(search: string): DataManagePreviewTarget {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const kind = params.get('kind');
  const editId = String(params.get('editId') || '').trim();
  if (kind === 'edit-owned' && editId) return { kind: 'edit-owned', editId };
  return { kind: 'create-owned' };
}

/** preview 自有数据源创建页（免登 returnUrl，始终带 source=sclaw） */
export const CREATE_OWNED_DATASOURCE_URL = buildDataManagePreviewUrl({ kind: 'create-owned' });

/** preview 自己的列表/首页：嵌入时视为离开业务页，SClaw 应回到数据管理 */
export function isPreviewLeaveHash(url: string): boolean {
  const hash = String(url || '').split('#')[1] || '';
  const path = hash.split('?')[0].replace(/\/+$/, '') || '/';
  return path === '/data-model'
    || path === '/data-model/create'
    || path === '/data-model/datasources'
    || path === '/data-model/platform-datasources'
    || path === '/data-model/history'
    || path === '/data-model/report-list'
    || path === '/report-square';
}
