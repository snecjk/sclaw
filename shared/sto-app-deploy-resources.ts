export interface DeployResourceRecord {
  id: number;
  appName: string;
  env: string;
  iterateId?: number;
  iterateVersion?: string;
  instanceId?: number;
  pages: string[];
  createTime?: number;
  createTimeStr?: string;
  updateTime?: number;
  available: boolean;
}

export interface DeployResourcePage {
  url: string;
  fileName: string;
  entry: boolean;
  available: boolean;
}

function asString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function asNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function unwrapRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  const row = raw as Record<string, unknown>;
  for (const key of ['result', 'body', 'data'] as const) {
    if (key in row) {
      const nested = unwrapRows(row[key]);
      if (nested.length > 0 || Array.isArray(row[key])) return nested;
    }
  }
  return [];
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isEntryPage(url: string): boolean {
  try {
    return new URL(url).pathname.endsWith('/index.html');
  } catch {
    return false;
  }
}

export function parseDeployResourceRecords(raw: unknown): DeployResourceRecord[] {
  return unwrapRows(raw).flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const id = asNumber(row.id);
    if (id === undefined) return [];
    const rawPages = Array.isArray(row.pages) ? row.pages : [];
    const pages = rawPages.flatMap((page) => {
      const url = asString(page);
      return url && isHttpUrl(url) ? [url] : [];
    });
    return [{
      id,
      appName: asString(row.appName, row.app_name) ?? '',
      env: asString(row.env) ?? '',
      iterateId: asNumber(row.iterateId, row.iterate_id),
      iterateVersion: asString(row.iterateVersion, row.iterate_version),
      instanceId: asNumber(row.instanceId, row.instance_id),
      pages,
      createTime: asNumber(row.createTime, row.create_time),
      createTimeStr: asString(row.createTimeStr, row.create_time_str),
      updateTime: asNumber(row.updateTime, row.update_time),
      available: row.available === true,
    }];
  });
}

export function deployResourceFileName(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    return decodeURIComponent(pathname.split('/').filter(Boolean).pop() ?? '') || '资源地址';
  } catch {
    return '资源地址';
  }
}

export function flattenDeployResourcePages(records: DeployResourceRecord[]): DeployResourcePage[] {
  const seen = new Set<string>();
  const pages: DeployResourcePage[] = [];
  for (const record of records) {
    for (const value of record.pages) {
      const url = value.trim();
      if (!url || !isHttpUrl(url) || seen.has(url)) continue;
      seen.add(url);
      pages.push({
        url,
        fileName: deployResourceFileName(url),
        entry: isEntryPage(url),
        available: record.available,
      });
    }
  }
  return pages;
}
