import { memoryCenterFetchForSession, StoMemoryApiError } from '../services/sto-memory-api-fetch';
import type {
  CloudScheduleTaskRow,
  CloudScheduleTaskUpsertBody,
} from './schedule-tasks-cloud-mapper';

const CLOUD_BASE = '/agent/v1/schedule-tasks-cloud';
/** 云端出站超时。后台 push 晚一轮再试即可；正常成功是几百毫秒。 */
const CLOUD_FETCH_TIMEOUT_MS = 5_000;

function withCloudTimeout(init: RequestInit): RequestInit {
  return { ...init, signal: AbortSignal.timeout(CLOUD_FETCH_TIMEOUT_MS) };
}

export interface CloudUpsertResult {
  id: string;
  version: number;
}

/** 从 memory-center 包装体里取出 `data`；没有则原样返回。 */
function unwrapData(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: unknown }).data;
  }
  return payload;
}

/**
 * list 必须能认出「任务列表」：根数组、`data` 数组、或 `{ items }`。
 * 空数组表示云端确为空（可 bootstrap）；畸形 200 不得当成空。
 */
function parseCloudListPayload(payload: unknown): CloudScheduleTaskRow[] {
  if (Array.isArray(payload)) return payload as CloudScheduleTaskRow[];
  if (!payload || typeof payload !== 'object') {
    throw new StoMemoryApiError('云端 list 响应无效', 502);
  }
  const record = payload as Record<string, unknown>;
  if (record.success === false) {
    throw new StoMemoryApiError('云端 list 失败', 400);
  }
  const data = 'data' in record ? record.data : record;
  if (Array.isArray(data)) return data as CloudScheduleTaskRow[];
  if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: CloudScheduleTaskRow[] }).items;
  }
  throw new StoMemoryApiError('云端 list 未返回任务列表', 502);
}

/**
 * 拉取当前用户的云端任务镜像（有 pending 时的出队 / sync-status / pull 走这条）。
 * @param includeDeleted 是否含墓碑；true 时带 `includeDeleted=1`
 * @returns 云端行列表；信封无法解析为列表时抛错（push tick catch 跳过，不 bootstrap）
 */
export async function listScheduleTasksCloud(includeDeleted: boolean): Promise<CloudScheduleTaskRow[]> {
  const query = includeDeleted ? '?includeDeleted=1' : '';
  const payload = await memoryCenterFetchForSession(
    `${CLOUD_BASE}/list${query}`,
    withCloudTimeout({ method: 'GET' }),
  );
  return parseCloudListPayload(payload);
}

/**
 * 全量覆盖一条云端任务；新建 version=1，已有则服务端 version+1。
 * @param body 本地行映射出的 POST body（不含 owner / version）
 * @returns `{ id, version }`；缺字段则抛错
 */
export async function upsertScheduleTaskCloud(
  body: CloudScheduleTaskUpsertBody,
): Promise<CloudUpsertResult> {
  const payload = await memoryCenterFetchForSession(
    CLOUD_BASE,
    withCloudTimeout({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  const data = unwrapData(payload) as CloudUpsertResult;
  if (!data?.id || typeof data.version !== 'number') {
    throw new Error('云端 upsert 未返回 id/version');
  }
  return { id: String(data.id), version: Number(data.version) };
}

/**
 * 批量全量覆盖；服务端仍逐条 upsert。当前 push 未调用。
 * @param bodies 待写入的云端 body 列表
 * @returns 每条 `{ id, success, version? }`；非数组则 `[]`
 */
export async function upsertScheduleTasksCloudBatch(
  bodies: CloudScheduleTaskUpsertBody[],
): Promise<Array<{ id: string; success: boolean; version?: number }>> {
  const payload = await memoryCenterFetchForSession(
    `${CLOUD_BASE}/batch`,
    withCloudTimeout({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: bodies }),
    }),
  );
  const data = unwrapData(payload);
  return Array.isArray(data) ? (data as Array<{ id: string; success: boolean; version?: number }>) : [];
}
