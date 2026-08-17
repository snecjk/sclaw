/**
 * STO policy code-application HTTP client (SClaw REST, not sai-cli /cli/*).
 * List: GET /sto-policy/api/v1/code-applications
 * Create: POST /sto-policy/api/v1/code-applications
 * Soft-delete: POST /sto-policy/api/v1/code-applications/{applicationId}/offline
 */

import { getStoPolicyHybridApiHostForSsoEnv } from '../../shared/env-config';
import {
  applicationCodeFromName,
  parseCodeApplicationDetail,
  parseCodeApplicationList,
  parsePolicyApiError,
  type CodeApplicationRecord,
} from '../../shared/code-application-catalog';
import { getSsoEnvironment, getStoToken } from '../utils/auth-store';
import { createUlid } from '../utils/ulid';
import { logger } from '../utils/logger';
import { proxyAwareFetch } from '../utils/proxy-fetch';

const REQUEST_TIMEOUT_MS = 30_000;

export async function resolveCodeApplicationPolicyOrigin(): Promise<string> {
  const ssoEnv = await getSsoEnvironment();
  const host = getStoPolicyHybridApiHostForSsoEnv(ssoEnv);
  logger.info(`[code-application] origin ssoEnv=${ssoEnv} host=${host}`);
  return `https://${host}`;
}

async function policyFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<unknown> {
  const token = await getStoToken();
  if (!token) {
    logger.warn('[code-application] missing stoToken');
    throw new Error('未登录或 stoToken 已过期，请重新登录');
  }

  const method = (init.method || 'GET').toUpperCase();
  const url = `${await resolveCodeApplicationPolicyOrigin()}${path}`;
  logger.info(`[code-application] >>> ${method} ${url}`);
  let response: Awaited<ReturnType<typeof proxyAwareFetch>>;
  try {
    response = await proxyAwareFetch(url, {
      ...init,
      timeoutMs: init.timeoutMs ?? REQUEST_TIMEOUT_MS,
      headers: {
        stoToken: token,
        Accept: 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch (error) {
    logger.error(`[code-application] <<< ${method} ${url} network-error=${String(error)}`);
    throw error;
  }

  const text = await response.text().catch(() => '');
  logger.info(`[code-application] <<< ${method} ${url} status=${response.status} body=${text}`);

  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
  }

  if (!response.ok) {
    throw new Error(parsePolicyApiError(json, text || `请求失败 (${response.status})`));
  }

  if (
    typeof json === 'object'
    && json !== null
    && (json as { success?: boolean }).success === false
  ) {
    throw new Error(parsePolicyApiError(json, '策略服务返回失败'));
  }

  return json;
}

function cloudCreateFailedMessage(status?: string): string {
  const normalized = status?.trim().toUpperCase() ?? 'FAILED';
  return (
    `云端应用创建失败（status=${normalized}）：DevOps 初始化未成功，` +
    '无法写入 .sto/workspace.json。请在应用广场删除该应用后重试，或联系管理员检查 DevOps API。'
  );
}

function resolveApplicationCode(applicationName: string, applicationUid: string): string {
  const fromName = applicationCodeFromName(applicationName);
  if (fromName) return fromName;
  return `app-${applicationUid.slice(-8).toLowerCase()}`;
}

export async function createCodeApplication(input: {
  applicationName: string;
  description?: string | null;
}): Promise<CodeApplicationRecord> {
  const applicationName = input.applicationName.trim();
  if (!applicationName) throw new Error('应用名称不能为空');

  const applicationUid = createUlid();
  const applicationCode = resolveApplicationCode(applicationName, applicationUid);
  const payload: Record<string, string> = {
    applicationUid,
    applicationCode,
    applicationName,
  };
  const description = input.description?.trim();
  if (description) payload.description = description;

  logger.info(
    `[code-application] action=create name=${applicationName} code=${applicationCode} uid=${applicationUid}`,
  );
  const json = await policyFetch('/sto-policy/api/v1/code-applications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    timeoutMs: 0,
  });

  let created = parseCodeApplicationDetail(json);
  if (!created?.applicationId) {
    const listed = await listCodeApplications().catch(() => [] as CodeApplicationRecord[]);
    created = listed.find((item) => item.applicationUid === applicationUid)
      ?? listed.find((item) => item.applicationName === applicationName)
      ?? null;
    if (created) {
      logger.warn(
        `[code-application] action=create recovered from list applicationId=${created.applicationId} ` +
        `status=${created.status ?? '-'}`,
      );
    }
  }

  if (!created?.applicationId) {
    throw new Error('创建云端应用失败：响应缺少 applicationId');
  }

  const status = created.status?.trim().toUpperCase() ?? '';
  if (status === 'FAILED') {
    throw new Error(cloudCreateFailedMessage(status));
  }

  logger.info(
    `[code-application] action=create success applicationId=${created.applicationId} ` +
    `status=${created.status ?? '-'}`,
  );
  return created;
}

export async function listCodeApplications(): Promise<CodeApplicationRecord[]> {
  logger.info('[code-application] action=list');
  const json = await policyFetch('/sto-policy/api/v1/code-applications', { method: 'GET' });
  const apps = parseCodeApplicationList(json);
  logger.info(
    `[code-application] action=list count=${apps.length} apps=${JSON.stringify(
      apps.map((app) => ({
        applicationId: app.applicationId,
        applicationName: app.applicationName,
        status: app.status,
        previewUrl: app.previewUrl,
      })),
    )}`,
  );
  return apps;
}

export async function offlineCodeApplication(applicationId: string): Promise<void> {
  const id = applicationId.trim();
  if (!id) throw new Error('缺少 applicationId');
  logger.info(`[code-application] action=offline applicationId=${id}`);
  await policyFetch(
    `/sto-policy/api/v1/code-applications/${encodeURIComponent(id)}/offline`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
  );
  logger.info(`[code-application] action=offline success applicationId=${id}`);
}
