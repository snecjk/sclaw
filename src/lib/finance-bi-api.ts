import { hostApiFetch } from '@/lib/host-api';

export interface FinanceBiModelMenuItem {
  id: number;
  menuCode: string;
  modelCode: string;
  modelName?: string;
  modelDescription?: string;
  modelType?: string;
  category?: string;
  dataSourceList?: Array<{ displayName?: string; tableName?: string }>;
  coreFieldList?: Array<{ name?: string; originName?: string; fieldName?: string }>;
  scheduleText?: string;
  scheduleEnabled?: boolean;
  status: number;
  publishTime?: string;
  createBy?: string;
  createByName?: string;
  hasPermission?: boolean;
  accessRequestStatus?: 'pending' | 'approved' | 'rejected' | null;
}

export interface FinanceBiModelMenuListResult {
  page: number;
  pageSize: number;
  total: number;
  list: FinanceBiModelMenuItem[];
}

interface ApiEnvelope<T> {
  success: boolean;
  error?: string;
  data: T;
  /** 主进程换票调试信息（便于 DevTools 查看） */
  exchangeDebug?: {
    at?: string;
    exchangeApiFullUrl?: string | null;
    code?: string | null;
    apiBase?: string | null;
    skipLoginUrl?: string | null;
    exchangeHttpStatus?: number | null;
    exchangeOk?: boolean | null;
    exchangeBody?: unknown;
    tokenPrefix?: string | null;
    tokenLength?: number | null;
    sid?: string | null;
    requestMethod?: string;
    requestHeaders?: Record<string, string>;
    requestBody?: unknown;
    requestHeadersPreview?: Record<string, string>;
    error?: string;
  } | null;
  /** 列表接口入参 / 请求头 / 出参 */
  listCallDebug?: {
    at?: string;
    url?: string;
    method?: string;
    requestBody?: unknown;
    requestHeaders?: Record<string, string>;
    httpStatus?: number | null;
    ok?: boolean | null;
    responseBody?: unknown;
    error?: string;
  } | null;
}

function logExchangeDebug(debug: ApiEnvelope<unknown>['exchangeDebug']) {
  // 只打印换票本身；不要把后续 list 的 error 塞进换票结果里
  console.info('[finance-bi][我的报表1][exchange] 换票调用接口全称 =', debug?.exchangeApiFullUrl ?? '(无)');
  console.info('[finance-bi][我的报表1][exchange] 换票接口全部入参 =', {
    method: debug?.requestMethod ?? 'POST',
    url: debug?.exchangeApiFullUrl ?? null,
    headers: debug?.requestHeaders ?? null,
    body: debug?.requestBody ?? (debug?.code ? { authorizationCode: debug.code, code: debug.code } : null),
    skipLoginUrl: debug?.skipLoginUrl ?? null,
  });
  console.info('[finance-bi][我的报表1][exchange] 换票后结果 =', {
    apiBase: debug?.apiBase,
    httpStatus: debug?.exchangeHttpStatus,
    ok: debug?.exchangeOk,
    body: debug?.exchangeBody,
    tokenPrefix: debug?.tokenPrefix,
    tokenLength: debug?.tokenLength,
    sid: debug?.sid,
    requestHeaders: debug?.requestHeadersPreview,
    exchangeError: debug?.error ?? null,
  });
}

function logListCallDebug(
  debug: ApiEnvelope<unknown>['listCallDebug'],
  hostError?: string,
) {
  if (!debug) {
    console.warn('[finance-bi][我的报表1][list] 无 listCallDebug（主进程未回传）');
    if (hostError) {
      console.error('[finance-bi][我的报表1][list] Host 返回失败 =', hostError);
    }
    return;
  }
  console.info('[finance-bi][我的报表1][list] 入参 body =', debug.requestBody ?? null);
  console.info('[finance-bi][我的报表1][list] 入参 请求头 =', debug.requestHeaders ?? null);
  console.info('[finance-bi][我的报表1][list] 出参 =', {
    url: debug.url,
    method: debug.method,
    httpStatus: debug.httpStatus,
    ok: debug.ok,
    body: debug.responseBody,
    listError: debug.error ?? hostError ?? null,
  });
  if (hostError) {
    console.error(
      '[finance-bi][我的报表1][list] 列表接口鉴权失败（换票已成功，失败发生在 /bi/modelMenu/list）=',
      hostError,
    );
  }
}

export async function listFinanceBiModelMenu(params: {
  keyword?: string;
  page?: number;
  pageSize?: number;
}): Promise<FinanceBiModelMenuListResult> {
  const res = await hostApiFetch<ApiEnvelope<FinanceBiModelMenuListResult>>(
    '/api/finance-bi/model-menu/list',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    },
  );
  logExchangeDebug(res?.exchangeDebug);
  logListCallDebug(res?.listCallDebug, res?.success ? undefined : res?.error);
  if (!res?.success) {
    throw new Error(res?.error || '加载报表列表失败');
  }
  return res.data;
}

export async function applyFinanceBiModelMenuAccess(menuCode: string): Promise<void> {
  const res = await hostApiFetch<ApiEnvelope<unknown>>(
    '/api/finance-bi/model-menu/access/apply',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ menuCode }),
    },
  );
  if (!res?.success) {
    throw new Error(res?.error || '申请权限失败');
  }
}

export function formatFinanceBiAutoUpdate(
  item: { scheduleText?: string; scheduleEnabled?: boolean },
): string {
  const enabled = item.scheduleEnabled != null ? item.scheduleEnabled === true : !!item.scheduleText;
  if (!enabled) return '未开启';
  const trimmed = item.scheduleText?.trim();
  return trimmed || '已开启';
}

export function formatFinanceBiCreator(
  item: { createByName?: string; createBy?: string },
): string {
  const name = item.createByName?.trim() || item.createBy?.trim() || '';
  return name ? `创建人：${name}` : '创建人：—';
}

/** —— 报表产物（对齐 preview /data-model/history） —— */

export interface FinanceBiProductModelOption {
  modelId: string;
  modelName: string;
}

export interface FinanceBiProductRecord {
  recordCode: string;
  step?: number;
  execStatus: string;
  tableName?: string;
  tableType: 'detail' | 'summary' | string;
}

export interface FinanceBiProductBatch {
  batchCode: string;
  batchName?: string | null;
  modelCode: string;
  triggerType?: string;
  batchStatus: string;
  stepCount?: number;
  createByName?: string;
  createTime: string;
  recordList?: FinanceBiProductRecord[];
}

export interface FinanceBiProductListResult {
  list: FinanceBiProductBatch[];
  total: number;
  pageNum: number;
  pageSize: number;
}

export type FinanceBiProductFilterType = 'text' | 'timeRange' | 'numberRange';

export interface FinanceBiProductPreviewFilter {
  field: string;
  filterType: FinanceBiProductFilterType;
  value?: string;
  min?: string;
  max?: string;
}

export interface FinanceBiProductPreviewField {
  originName?: string;
  name?: string;
  fieldName?: string;
  fieldType?: string;
  deType?: number;
  filterType?: FinanceBiProductFilterType;
  dataTypeName?: string;
  groupName?: string;
  sourceTable?: string;
  tableName?: string;
}

export interface FinanceBiProductPreviewResult {
  fieldList: FinanceBiProductPreviewField[];
  rows: Array<Record<string, unknown>>;
  total: number;
  pageNum: number;
  pageSize: number;
  columnTotals?: Record<string, string>;
}

export interface FinanceBiProductExportResult {
  exportKey?: string;
  exportCode?: string;
  exportStatus: 'pending' | 'running' | 'success' | 'failed' | string;
  downloadUrl?: string;
  fileName?: string;
  errorMsg?: string;
}

export interface FinanceBiExportRecord {
  id?: number;
  exportKey: string;
  productCode: string;
  tableType?: string;
  tableTypeName?: string;
  filterSnapshot?: string;
  exportStatus: string;
  exportStatusName?: string;
  fileName?: string;
  fileSize?: number;
  fileSizeText?: string;
  errorMsg?: string;
  createBy?: string;
  createByName?: string;
  createTime?: string;
  updateTime?: string;
  downloadUrl?: string;
}

export interface FinanceBiExportRecordListResult {
  list: FinanceBiExportRecord[];
  total: number;
  pageNum: number;
  pageSize: number;
}

const BATCH_STATUS_NAME: Record<string, string> = {
  running: '生成中',
  done: '已完成',
  failed: '失败',
  expired: '已过期',
};

export function financeBiBatchStatusLabel(status?: string): string {
  if (!status) return '';
  return BATCH_STATUS_NAME[status] || status;
}

export function pickFinanceBiProductRecord(
  records: FinanceBiProductRecord[] | undefined,
  tableType: 'detail' | 'summary',
): FinanceBiProductRecord | undefined {
  return (records || []).find((r) => r.tableType === tableType);
}

export function isFinanceBiProductRecordReady(
  record?: FinanceBiProductRecord,
): record is FinanceBiProductRecord {
  return Boolean(record && record.execStatus === 'done' && record.tableName);
}

export interface FinanceBiPreviewEmbedAuth {
  token: string;
  sid?: string;
  userInfo: Record<string, unknown>;
  stoBiUserInfo: Record<string, unknown>;
  exp: number;
  time: number;
  preloadUrl?: string;
}

export async function fetchFinanceBiPreviewEmbedAuth(): Promise<FinanceBiPreviewEmbedAuth> {
  const data = await postFinanceBi<FinanceBiPreviewEmbedAuth>(
    '/api/finance-bi/preview-embed-auth',
    {},
  );
  if (!data?.token?.trim()) {
    throw new Error('财务 BI 登录态无效');
  }
  return data;
}

export async function fetchFinanceBiPreviewEmbedBridge(): Promise<string | undefined> {
  try {
    const data = await postFinanceBi<{ preloadUrl?: string }>(
      '/api/finance-bi/preview-embed-bridge',
      {},
    );
    return data?.preloadUrl?.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function postFinanceBi<T>(path: string, body: unknown = {}): Promise<T> {
  const res = await hostApiFetch<ApiEnvelope<T>>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res?.success) {
    throw new Error(res?.error || '请求失败');
  }
  return res.data;
}

export async function listFinanceBiProductModelOptions(): Promise<FinanceBiProductModelOption[]> {
  const data = await postFinanceBi<FinanceBiProductModelOption[]>(
    '/api/finance-bi/product/model-options',
    {},
  );
  return Array.isArray(data) ? data : [];
}

export async function listFinanceBiProducts(params: {
  modelCode?: string;
  dateStart?: string;
  dateEnd?: string;
  batchStatus?: string;
  pageNum?: number;
  pageSize?: number;
}): Promise<FinanceBiProductListResult> {
  return postFinanceBi<FinanceBiProductListResult>('/api/finance-bi/product/list', params);
}

export async function queryFinanceBiProductRecord(params: {
  recordCode: string;
  filters?: FinanceBiProductPreviewFilter[];
  pageNum?: number;
  pageSize?: number;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
}): Promise<FinanceBiProductPreviewResult> {
  return postFinanceBi<FinanceBiProductPreviewResult>(
    '/api/finance-bi/product/record/query',
    params,
  );
}

export async function exportFinanceBiProductData(params: {
  code: string;
  tableType: 'detail' | 'summary';
  filters?: FinanceBiProductPreviewFilter[];
}): Promise<FinanceBiProductExportResult> {
  return postFinanceBi<FinanceBiProductExportResult>('/api/finance-bi/product/export', params);
}

export async function listFinanceBiProductExportRecords(params: {
  pageNum?: number;
  pageSize?: number;
} = {}): Promise<FinanceBiExportRecordListResult> {
  return postFinanceBi<FinanceBiExportRecordListResult>(
    '/api/finance-bi/product/export/record/list',
    params,
  );
}

const DATE_NAME_RE = /日期|时间|date|time|dt$/i;
const NUMBER_NAME_RE = /金额|数量|合计|总计|amount|qty|count|num|price|fee|rate/i;

export function inferFinanceBiFilterType(
  field: FinanceBiProductPreviewField,
): FinanceBiProductFilterType {
  if (field.filterType === 'text' || field.filterType === 'timeRange' || field.filterType === 'numberRange') {
    return field.filterType;
  }
  if (field.deType === 1) return 'timeRange';
  if (field.deType === 2 || field.deType === 3) return 'numberRange';
  const name = `${field.name || ''}${field.originName || ''}${field.fieldName || ''}`;
  if (DATE_NAME_RE.test(name)) return 'timeRange';
  if (NUMBER_NAME_RE.test(name)) return 'numberRange';
  return 'text';
}

export function financeBiFieldKey(
  field: FinanceBiProductPreviewField,
  index: number,
): string {
  return (field.originName || field.fieldName || `col_${index}`).trim() || `col_${index}`;
}

/** —— 数据源管理（对齐 preview /data-model/datasources） —— */

export type FinanceBiDatasourcePlatformType = 'platform' | 'user';

export interface FinanceBiDatasourceSonListParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
  type?: string;
  platformType?: FinanceBiDatasourcePlatformType | string;
  publishStatus?: string;
  status?: string;
}

export interface FinanceBiDatasourceSonModelRef {
  code?: string;
  name?: string;
  createBy?: string;
  createByName?: string;
}

export interface FinanceBiDatasourceSonDTO {
  id?: string | number;
  code?: string;
  name?: string;
  description?: string;
  type?: string;
  tableName?: string;
  platformType?: string;
  group?: string;
  publishStatus?: string;
  configuration?: string;
  status?: string;
  statusName?: string;
  statusLabel?: string;
  msg?: string;
  frequency?: string;
  executeTime?: string;
  executeDay?: string;
  models?: FinanceBiDatasourceSonModelRef[];
  usageCount?: number;
  createBy?: string;
  createByName?: string;
  createTime?: number | string;
  updateTime?: number | string;
}

export interface FinanceBiDatasourceSonPageResult {
  page: number;
  pageSize: number;
  total: number;
  totalPages?: number;
  list: FinanceBiDatasourceSonDTO[];
}

export async function listFinanceBiDatasourceSon(
  params: FinanceBiDatasourceSonListParams = {},
): Promise<FinanceBiDatasourceSonPageResult> {
  const data = await postFinanceBi<FinanceBiDatasourceSonPageResult>(
    '/api/finance-bi/datasource-son/list',
    params,
  );
  return {
    page: data?.page || params.page || 1,
    pageSize: data?.pageSize || params.pageSize || 20,
    total: data?.total || 0,
    totalPages: data?.totalPages,
    list: data?.list || [],
  };
}

export async function deleteFinanceBiDatasourceSon(code: string): Promise<void> {
  await postFinanceBi('/api/finance-bi/datasource-son/delete', { code });
}
