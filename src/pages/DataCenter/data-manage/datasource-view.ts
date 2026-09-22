export type DatasourceAccessMode = 'api' | 'warehouse' | 'db' | 'file';

export interface DatasourceFieldView {
  displayName: string;
  rawName: string;
  oldName?: string;
  type?: string;
  sample?: string;
}

export interface DatasourceApiConfigView {
  url: string;
  method: string;
  authType: string;
  timeout: string;
  retry: string;
  retryInterval: string;
}

export interface DatasourceModelRef {
  code?: string;
  name?: string;
  createBy?: string;
  createByName?: string;
}

export interface DatasourceSonDTO {
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
  models?: DatasourceModelRef[];
  usageCount?: number;
  createBy?: string;
  createByName?: string;
  createTime?: number | string;
  updateTime?: number | string;
}

export interface DatasourceViewItem {
  id?: string | number;
  code: string;
  name: string;
  type: string;
  accessMode: DatasourceAccessMode;
  description: string;
  group: string;
  createByName: string;
  createTime: string;
  msg: string;
  failPolicy: string;
  syncTimeRange: string;
  apiConfig?: DatasourceApiConfigView;
  fields: DatasourceFieldView[];
  models: DatasourceModelRef[];
  statusLabel: string;
  statusTone: 'success' | 'danger' | 'warning';
  statusName: string;
  updateFreq: string;
  updatedAt: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseConfiguration(raw?: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

export function mapBackendType(type?: string): DatasourceAccessMode {
  const raw = (type || '').toLowerCase();
  if (raw === 'api') return 'api';
  if (raw === 'excel' || raw === 'file') return 'file';
  if (raw === 'warehouse') return 'warehouse';
  if (raw === 'table' || raw === 'db' || raw === 'mysql' || raw === 'postgresql') return 'db';
  return 'api';
}

function flattenFields(fields: unknown[]): DatasourceFieldView[] {
  const result: DatasourceFieldView[] = [];
  const walk = (list: unknown[]) => {
    for (const item of list) {
      const rec = asRecord(item);
      if (!rec) continue;
      const children = Array.isArray(rec.children) ? rec.children : [];
      if (children.length) {
        walk(children);
        continue;
      }
      const displayName = String(rec.displayName || rec.name || rec.rawName || rec.oldName || '').trim();
      const rawName = String(rec.oldName || rec.rawName || rec.originName || displayName).trim();
      const enabled = rec.enabled !== undefined ? rec.enabled !== false : rec.checked !== false;
      if (!enabled) continue;
      if (!displayName && !rawName) continue;
      result.push({
        displayName: displayName || rawName,
        rawName: rawName || displayName,
        oldName: String(rec.oldName || rec.originName || '').trim() || undefined,
        type: String(rec.type || '').trim() || undefined,
        sample: String(rec.sample || '').trim() || undefined,
      });
    }
  };
  walk(fields);
  return result;
}

function configurationFields(cfg: Record<string, unknown>): DatasourceFieldView[] {
  const uiFields = Array.isArray(cfg.uiFields) ? cfg.uiFields : null;
  const fields = Array.isArray(cfg.fields) ? cfg.fields : [];
  return flattenFields(uiFields ?? fields);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatDatasourceDateTime(value?: number | string | number[] | null): string {
  if (value == null || value === '') return '—';
  if (Array.isArray(value) && value.length >= 3) {
    const [year, month, day, hour = 0, minute = 0] = value;
    return `${year}/${pad2(Number(month))}/${pad2(Number(day))} ${pad2(Number(hour))}:${pad2(Number(minute))}`;
  }
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatFieldSummary(fields: DatasourceFieldView[], all = false): string {
  const names = fields.map((field) => field.displayName).filter(Boolean);
  if (!names.length) return '';
  if (all || names.length <= 3) return names.join('、');
  return `${names.slice(0, 3).join('、')} 等${names.length}个字段`;
}

export function formatModelRefsUsage(models?: DatasourceModelRef[] | null): string {
  const list = models || [];
  if (!list.length) return '未引用';
  return `被 ${list.length} 个模型使用`;
}

export function formatModelRefsTitle(models?: DatasourceModelRef[] | null): string {
  const list = models || [];
  if (!list.length) return '暂无模型引用';
  return list
    .map((item) => {
      const name = String(item.name || item.code || '').trim() || '未命名模型';
      const owner = String(item.createByName || item.createBy || '').trim();
      return owner ? `${name} (${owner})` : name;
    })
    .join('、');
}

function normalizeSyncStatus(status?: string): string {
  if (!status) return '';
  let raw = String(status).trim();
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed[0]?.status) raw = String(parsed[0].status);
    } catch {
      // keep original
    }
  }
  return raw;
}

export function syncStatusTone(status?: string, statusLabel?: string): 'success' | 'danger' | 'warning' {
  const health = String(statusLabel || '').trim();
  if (health === '正常' || health === 'NORMAL') return 'success';
  if (health === '异常' || health === 'ABNORMAL' || health === '失败') return 'danger';
  const raw = normalizeSyncStatus(status).toLowerCase();
  if (!raw) return 'warning';
  if (
    raw === '正常'
    || raw === 'success'
    || raw === 'normal'
    || raw === 'sync_success'
    || raw === 'partial_success'
    || raw === 'notify_success'
  ) {
    return 'success';
  }
  if (raw === '失败' || raw === 'failed' || raw === 'error' || raw === 'sync_failed' || raw === 'abnormal') {
    return 'danger';
  }
  return 'warning';
}

export function displaySyncStatusLabel(status?: string, statusLabel?: string): string {
  const health = String(statusLabel || '').trim();
  if (health) return health;
  const raw = normalizeSyncStatus(status);
  if (!raw) return '正常';
  const lower = raw.toLowerCase();
  if (raw === '正常' || lower === 'success' || lower === 'normal') return '正常';
  if (raw === '失败' || lower === 'failed' || lower === 'error') return '失败';
  return raw === '未检测' ? '正常' : raw;
}

function scheduleFreqLabel(frequency?: string | null): string {
  const raw = String(frequency || '').trim().toLowerCase();
  if (raw === 'daily') return '每天';
  if (raw === 'weekly') return '每周';
  if (raw === 'monthly') return '每月';
  if (raw === 'hourly') return '每小时';
  if (raw === 'minute') return '每 5 分钟';
  return '';
}

export function formatUpdateFreq(
  cfg: Record<string, unknown>,
  dto: Pick<DatasourceSonDTO, 'frequency'>,
): string {
  const fromCfg = String(cfg.updateFreq || '').trim();
  if (fromCfg) return fromCfg;
  return scheduleFreqLabel(dto.frequency) || '手动刷新';
}

export function sonCode(item?: Pick<DatasourceSonDTO, 'code' | 'id'> | null): string {
  return String(item?.code || item?.id || '').trim();
}

export function isTableDatasource(item?: { type?: string; accessMode?: DatasourceAccessMode } | null): boolean {
  const type = String(item?.type || '').toLowerCase();
  return item?.accessMode === 'db' || type === 'table';
}

export function accessModeLabel(mode?: DatasourceAccessMode): string {
  if (mode === 'warehouse') return '数仓/中台表';
  if (mode === 'db') return '数据库表';
  if (mode === 'api') return 'API 接口';
  if (mode === 'file') return '本地文件';
  return mode || '—';
}

export function authTypeLabel(type?: string): string {
  if (type === 'none') return '无需认证';
  if (type === 'password') return '用户名密码';
  if (type === 'app') return 'AppKey/AppSecret';
  if (type === 'managed') return '选择已有密钥';
  return type || '—';
}

export function formatSyncTimeRange(range?: Record<string, unknown> | null): string {
  if (!range) return '未配置';
  const field = String(range.timeFilterField || '').trim();
  if (!field) return '未配置';
  const parts: string[] = [`字段: ${field}`];
  const months = Number(range.rangeMonths) || 0;
  const days = Number(range.rangeDays) || 0;
  if (months > 0) parts.push(`M-${months}月`);
  if (days > 0) parts.push(`T-${days}日`);
  return parts.length > 1 ? parts.join('，') : `${parts[0]}（窗口未配置）`;
}

export function toDatasourceViewItem(dto: DatasourceSonDTO): DatasourceViewItem {
  const cfg = parseConfiguration(dto.configuration);
  const accessMode = dto.type ? mapBackendType(dto.type) : mapBackendType(String(cfg.accessMode || 'api'));
  const fields = configurationFields(cfg);
  const lastSync = cfg.lastSyncTime ?? cfg.latestDataTime ?? dto.updateTime ?? dto.createTime;
  const api = asRecord(cfg.apiConfig);
  const apiUrl = String(api?.url || cfg.source || '').trim();
  return {
    id: dto.id,
    code: sonCode(dto),
    name: dto.name || '—',
    type: String(dto.type || cfg.accessMode || ''),
    accessMode,
    description: String(dto.description || '').trim(),
    group: String(dto.group || '').trim(),
    createByName: String(dto.createByName || dto.createBy || '').trim(),
    createTime: formatDatasourceDateTime(dto.createTime),
    msg: String(dto.msg || '').trim(),
    failPolicy: String(cfg.failPolicy || '允许使用上次成功数据'),
    syncTimeRange: formatSyncTimeRange(asRecord(cfg.syncTimeRange)),
    apiConfig: accessMode === 'api' ? {
      url: apiUrl,
      method: String(api?.method || 'GET'),
      authType: String(api?.authType || ''),
      timeout: String(api?.timeout || '12'),
      retry: String(api?.retry || '3'),
      retryInterval: String(api?.retryInterval || '5'),
    } : undefined,
    fields,
    models: dto.models || [],
    statusLabel: displaySyncStatusLabel(String(cfg.connectionStatus || dto.status || ''), dto.statusLabel),
    statusTone: syncStatusTone(String(cfg.connectionStatus || dto.status || ''), dto.statusLabel),
    statusName: String(dto.statusName || '').trim(),
    updateFreq: formatUpdateFreq(cfg, dto),
    updatedAt: formatDatasourceDateTime(lastSync as number | string | number[] | null),
  };
}
