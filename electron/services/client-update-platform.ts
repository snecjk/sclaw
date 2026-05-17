/**
 * Memory-center client update API: resolve (gray / feed) + events telemetry.
 * Hosts align with memory-center-web src/config/env.ts (API root + /api/v1).
 */
import { app } from 'electron';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SsoEnvironment } from '../utils/auth-store';
import { getSsoEnvironment, getStoToken } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { proxyAwareFetch } from '../utils/proxy-fetch';
import { logger } from '../utils/logger';

export const CLIENT_UPDATE_PRODUCT = 'sto-claw';

const PENDING_INSTALL_FILE = 'stoclaw-pending-install.json';

const MEMORY_CENTER_ORIGIN: Record<SsoEnvironment, string> = {
  'daily-external': 'https://baseinfo-aimemory-test.sto.cn',
  'pre-release': 'https://pre-baseinfo-aimemory.sto.cn',
  'production-external': 'https://baseinfo-aimemory.sto.cn',
  'production-internal': 'https://baseinfo-aimemory.sto.cn',
  'local': 'http://127.0.0.1:7001',
};

export function getMemoryCenterApiOrigin(env: SsoEnvironment): string {
  return MEMORY_CENTER_ORIGIN[env] ?? MEMORY_CENTER_ORIGIN['production-external'];
}

export type ClientUpdatePolicyPayload = {
  product?: string;
  current_version?: string | null;
  platform?: string | null;
};

export type ClientUpdatePolicyData = {
  product?: string;
  cohort?: string;
  update_offered: boolean;
  feed_base_url?: string | null;
  electron_channel?: string | null;
  feed_slug?: string | null;
  feed_name?: string | null;
  latest_version?: string | null;
  min_required_version?: string | null;
  check_interval_seconds?: number;
  current_version?: string | null;
  platform?: string | null;
};

/** 解析失败的详细原因，供 UI 展示具体错误 */
export type ResolveFailureReason = {
  /** HTTP 状态码（0 = 网络不可达） */
  httpStatus: number;
  /** 服务端返回的错误消息（如有） */
  serverMessage?: string;
  /** 异常信息（网络层错误） */
  exceptionMessage?: string;
};

type ResolveResult =
  | { ok: true; data: ClientUpdatePolicyData }
  | { ok: false; reason: ResolveFailureReason };

type ApiOk<T> = { success?: boolean; data?: T; errMessage?: string };

export type ClientUpdateEventItem = {
  event_type: string;
  client_version?: string | null;
  target_version?: string | null;
  feed_slug?: string | null;
  platform?: string | null;
};

function jsonAuthHeaders(token: string): Record<string, string> {
  return {
    ...buildStoMemoryCenterAuthHeaders(token),
    'Content-Type': 'application/json',
  };
}

const RESOLVE_TIMEOUT_MS = 20_000;

export async function resolveUpdatePolicy(
  token: string,
  env: SsoEnvironment,
  body: ClientUpdatePolicyPayload,
): Promise<ResolveResult> {
  const origin = getMemoryCenterApiOrigin(env);
  const url = `${origin}/api/v1/client-updates/resolve`;
  try {
    logger.info(`[client-update] resolve request: POST ${url} product=${body.product ?? CLIENT_UPDATE_PRODUCT}`);
    const result = await Promise.race([
      (async () => {
        const res = await proxyAwareFetch(url, {
          method: 'POST',
          headers: jsonAuthHeaders(token),
          body: JSON.stringify({
            product: body.product ?? CLIENT_UPDATE_PRODUCT,
            current_version: body.current_version ?? undefined,
            platform: body.platform ?? undefined,
          }),
        });
        const raw = await res.text();
        const json = JSON.parse(raw) as ApiOk<ClientUpdatePolicyData>;
        if (!res.ok) {
          const msg = json?.errMessage ?? raw.slice(0, 200);
          logger.warn(
            `[client-update] resolve HTTP ${res.status}: ${msg}`,
          );
          return { ok: false, reason: { httpStatus: res.status, serverMessage: msg } } as ResolveResult;
        }
        if (!json?.success || !json.data) {
          const msg = json?.errMessage ?? 'success=false or data missing';
          logger.warn(
            `[client-update] resolve bad response: ${msg}`,
          );
          return { ok: false, reason: { httpStatus: res.status, serverMessage: msg } } as ResolveResult;
        }
        logger.info(`[client-update] resolve ok: cohort=${json.data.cohort} offered=${json.data.update_offered} slug=${json.data.feed_slug}`);
        return { ok: true, data: json.data } as ResolveResult;
      })(),
      new Promise<ResolveResult>((_resolve) =>
        setTimeout(
          () => _resolve({ ok: false, reason: { httpStatus: 0, exceptionMessage: `resolve 请求超时（${Math.round(RESOLVE_TIMEOUT_MS / 1000)}秒未响应）` } }),
          RESOLVE_TIMEOUT_MS,
        ),
      ),
    ]);
    return result;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn('[client-update] resolve error:', msg);
    return { ok: false, reason: { httpStatus: 0, exceptionMessage: msg } };
  }
}

export async function postClientUpdateEvents(
  token: string,
  env: SsoEnvironment,
  events: ClientUpdateEventItem[],
): Promise<void> {
  if (events.length === 0) return;
  const origin = getMemoryCenterApiOrigin(env);
  const url = `${origin}/api/v1/client-updates/events`;
  try {
    const res = await proxyAwareFetch(url, {
      method: 'POST',
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        product: CLIENT_UPDATE_PRODUCT,
        events,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn(`[client-update] events post failed: ${res.status} ${text.slice(0, 200)}`);
    }
  } catch (e) {
    logger.warn('[client-update] events post error:', e);
  }
}

/** Fire-and-forget: uses current token/env; skips if no token. */
export function sendClientUpdateEventsFireAndForget(
  env: SsoEnvironment,
  events: ClientUpdateEventItem[],
): void {
  if (events.length === 0) return;
  void (async () => {
    const token = await getStoToken();
    if (!token) return;
    await postClientUpdateEvents(token, env, events);
  })();
}

export type PendingInstallRecord = {
  targetVersion: string;
  feedSlug?: string | null;
};

export async function writePendingInstallReport(record: PendingInstallRecord): Promise<void> {
  const fp = join(app.getPath('userData'), PENDING_INSTALL_FILE);
  await writeFile(fp, JSON.stringify(record), 'utf8');
}

/**
 * After upgrade restart: if userData contains pending record and version matches, report install_complete.
 */
export async function runPendingInstallReport(currentVersion: string, platform: string): Promise<void> {
  if (!app.isPackaged) return;
  const fp = join(app.getPath('userData'), PENDING_INSTALL_FILE);
  let raw: string;
  try {
    raw = await readFile(fp, 'utf8');
  } catch {
    return;
  }
  let rec: PendingInstallRecord;
  try {
    rec = JSON.parse(raw) as PendingInstallRecord;
  } catch {
    await unlink(fp).catch(() => {});
    return;
  }
  if (!rec?.targetVersion || rec.targetVersion !== currentVersion) {
    return;
  }
  await unlink(fp).catch(() => {});
  const env = await getSsoEnvironment();
  sendClientUpdateEventsFireAndForget(env, [
    {
      event_type: 'install_complete',
      client_version: currentVersion,
      target_version: rec.targetVersion,
      feed_slug: rec.feedSlug ?? null,
      platform,
    },
  ]);
}
