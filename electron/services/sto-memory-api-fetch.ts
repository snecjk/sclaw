/**
 * 主进程 → memory-center 的通用出站（不要和 Host 通用代理搞混）。
 *
 * ⚠️ AI 编码识别：
 * - renderer 调 Python：走 Host 通用代理 `handleAiMemoryAgentV1Routes`
 *   （前端路径 `/ai-memory/agent/v1/{rest}` → `{sto_base_url}/agent/v1/{rest}`）
 * - Electron 主进程调 Python：走本文件。主进程已在 Node 侧，禁止再绕
 *   localhost Host API / `ai-memory-agent-v1`，否则多一跳且依赖 Host 已启动。
 *
 * 路径直接写 Python 实际地址：`/agent/v1/...`。本函数注入 stoToken、SSO env，
 * 解析 JSON，非 2xx / `success:false` 抛 `StoMemoryApiError`。
 *
 * 选 token：`memoryCenterFetchForSession`（登录会话）/
 * `memoryCenterFetchForAi`（AI 资源 token）。
 */

import { getStoToken, getSsoEnvironment } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';
import { getAiResourceStoToken } from './sto-auth-mode';

export class StoMemoryApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'StoMemoryApiError';
    this.statusCode = statusCode;
  }
}

export function parseMemoryCenterErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'object' && payload !== null) {
    const record = payload as Record<string, unknown>;
    if (typeof record.errMessage === 'string' && record.errMessage.trim()) {
      return record.errMessage.trim();
    }
    if (typeof record.detail === 'string' && record.detail.trim()) {
      return record.detail.trim();
    }
    if (typeof record.error === 'string' && record.error.trim()) {
      return record.error.trim();
    }
  }
  return fallback;
}

export function extractMemoryCenterErrorFields(payload: unknown): {
  errCode?: string;
  errMessage?: string;
  traceId?: string;
} {
  if (!payload || typeof payload !== 'object') return {};
  const record = payload as Record<string, unknown>;
  const pick = (...values: unknown[]) => {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  };
  return {
    errCode: pick(record.errCode, record.err_code),
    errMessage: pick(record.errMessage, record.err_message, record.message),
    traceId: pick(record.traceId, record.trace_id),
  };
}

/** Human-readable downstream error for logs and UI (includes errCode / HTTP when present). */
export function formatMemoryCenterErrorDetail(
  payload: unknown,
  fallback: string,
  statusCode?: number,
): string {
  const { errCode, errMessage, traceId } = extractMemoryCenterErrorFields(payload);
  const message = errMessage || parseMemoryCenterErrorMessage(payload, fallback);
  const parts = [message];
  if (errCode) parts.push(`errCode=${errCode}`);
  if (statusCode != null && statusCode > 0) parts.push(`HTTP ${statusCode}`);
  if (traceId) parts.push(`traceId=${traceId}`);
  return parts.join(' · ');
}

/**
 * 主进程通用出站：带指定 token 直打 `{sto_base_url}{path}`。
 * 仅供本文件两个 wrapper 使用；业务代码请调 ForSession / ForAi，不要再套一层 Host 代理。
 */
async function memoryCenterFetchWithToken(
  path: string,
  init: RequestInit,
  token: string | null,
  errorClass: typeof StoMemoryApiError = StoMemoryApiError,
): Promise<unknown> {
  if (!token) {
    throw new errorClass('未登录或 stoToken 已过期，请重新登录', 401);
  }

  const baseUrl = await resolveStoBaseUrl();
  const url = `${baseUrl}${path}`;
  const ssoEnv = await getSsoEnvironment();

  const response = await fetch(url, {
    ...init,
    headers: {
      ...buildStoMemoryCenterAuthHeaders(token),
      'X-Sto-Sso-Env': ssoEnv,
      ...(init.headers as Record<string, string> | undefined),
    },
  });

  const text = await response.text().catch(() => '');
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
  }

  if (!response.ok) {
    throw new errorClass(
      formatMemoryCenterErrorDetail(json, text || `请求失败 (${response.status})`, response.status),
      response.status,
    );
  }

  if (
    typeof json === 'object' &&
    json !== null &&
    (json as { success?: boolean }).success === false
  ) {
    throw new errorClass(formatMemoryCenterErrorDetail(json, '请求失败', 400), 400);
  }

  return json;
}

/** 主进程出站：用当前登录 stoToken（账号切换、站点审计、定时任务云端 sync 等）。 */
export async function memoryCenterFetchForSession(
  path: string,
  init: RequestInit,
  errorClass: typeof StoMemoryApiError = StoMemoryApiError,
): Promise<unknown> {
  const token = await getStoToken();
  return memoryCenterFetchWithToken(path, init, token, errorClass);
}

/** 主进程出站：用 AI 资源 stoToken（SK ensure、模型、总部额度档位等）。 */
export async function memoryCenterFetchForAi(
  path: string,
  init: RequestInit,
  errorClass: typeof StoMemoryApiError = StoMemoryApiError,
): Promise<unknown> {
  const token = await getAiResourceStoToken();
  return memoryCenterFetchWithToken(path, init, token, errorClass);
}
