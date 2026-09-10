/**
 * sai-cli `siteapp` command helpers.
 */

import { logger } from './logger';
import { runSai, SAI_POLICY_TIMEOUT_MS } from './sai-cli';
import { createUlid } from './ulid';
import {
  normalizeSiteAppPageType,
  type SiteAppPageType,
} from '../../shared/site-app-catalog';
import {
  parseSiteappApplicationCreate,
  parseSiteappRepositoryProvision,
  parseSiteappRevision,
  siteappCliErrorMessage,
  type SiteappRepositoryProvision,
} from '../../shared/siteapp-cli-payload';

const SITEAPP_TIMEOUT_MS = SAI_POLICY_TIMEOUT_MS;
const SITEAPP_LOG_MAX_CHARS = 12_000;

function serializeForSiteappLog(value: unknown, maxChars = SITEAPP_LOG_MAX_CHARS): string {
  try {
    const text = JSON.stringify(value);
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}…[truncated ${text.length - maxChars} chars]`;
  } catch {
    return '[unserializable]';
  }
}

function logSiteappCliRequest(
  command: string[],
  options?: { params?: Record<string, unknown>; extraArgs?: string[] },
): void {
  logger.info(
    `[siteapp] >>> ${command.join(' ')} params=${serializeForSiteappLog(options?.params ?? null)} ` +
    `extraArgs=${serializeForSiteappLog(options?.extraArgs ?? null)}`,
  );
}

function logSiteappCliResult(command: string[], result: { ok: boolean; exitCode: number; error?: unknown; data?: unknown }): void {
  const payload = {
    ok: result.ok,
    exitCode: result.exitCode,
    error: result.error,
    data: result.data,
  };
  const line = `[siteapp] <<< ${command.join(' ')} ${serializeForSiteappLog(payload)}`;
  if (result.ok) logger.info(line);
  else logger.error(line);
}

async function runSiteapp(
  command: string[],
  options?: {
    params?: Record<string, unknown>;
    extraArgs?: string[];
    timeoutMs?: number;
  },
) {
  logSiteappCliRequest(command, options);
  const args = [...command];
  if (options?.params && Object.keys(options.params).length > 0) {
    args.push('--params', JSON.stringify(options.params));
  }
  if (options?.extraArgs) args.push(...options.extraArgs);
  args.push('-f', 'json');
  const result = await runSai(args, options?.timeoutMs ?? SITEAPP_TIMEOUT_MS);
  logSiteappCliResult(command, result);
  return result;
}

export function buildSiteAppCreateParams(input: {
  name: string;
  description?: string | null;
  iconUrl?: string | null;
  pageType?: SiteAppPageType | null;
}): Record<string, string> {
  const name = input.name.trim();
  if (!name) throw new Error('应用名称不能为空');
  const params: Record<string, string> = {
    name,
    page_type: normalizeSiteAppPageType(input.pageType),
  };
  const description = input.description?.trim();
  if (description) params.description = description;
  const iconUrl = input.iconUrl?.trim();
  if (iconUrl) params.icon_url = iconUrl;
  return params;
}

export async function siteappApplicationCreate(input: {
  name: string;
  description?: string | null;
  iconUrl?: string | null;
  pageType?: SiteAppPageType | null;
}) {
  const params = buildSiteAppCreateParams(input);
  logger.info(`[siteapp] application create name=${params.name} pageType=${params.page_type}`);
  const result = await runSiteapp(['siteapp', 'application', 'create'], { params });
  if (!result.ok) throw new Error(siteappCliErrorMessage(result));
  const created = parseSiteappApplicationCreate(result.data);
  if (!created?.appCode) throw new Error('创建应用失败：响应缺少 app_code');
  return created;
}

export async function siteappRepositoryProvision(appCode: string): Promise<SiteappRepositoryProvision> {
  const code = appCode.trim();
  if (!code) throw new Error('缺少 app_code');
  logger.info(`[siteapp] repository provision appCode=${code}`);
  const result = await runSiteapp(['siteapp', 'repository', 'provision'], {
    params: { app_code: code },
    timeoutMs: 60_000,
  });
  if (!result.ok) throw new Error(siteappCliErrorMessage(result));
  const provisioned = parseSiteappRepositoryProvision(result.data);
  if (!provisioned?.appCode) throw new Error('仓库 provision 失败');
  return provisioned;
}

export async function siteappRevisionCreate(params: Record<string, string>) {
  return runSiteapp(['siteapp', 'revision', 'create'], { params });
}

export async function siteappSourceUpload(input: {
  appCode: string;
  revisionId: string;
  sourceFile: string;
}) {
  const appCode = input.appCode.trim();
  const revisionId = input.revisionId.trim();
  const sourceFile = input.sourceFile.trim();
  if (!appCode || !revisionId || !sourceFile) throw new Error('上传参数不完整');
  return runSiteapp(['siteapp', 'source', 'upload'], {
    extraArgs: [
      '--app_code', appCode,
      '--revision_id', revisionId,
      '--source_file', sourceFile,
    ],
  });
}

export async function siteappSourceDownload(appCode: string) {
  const code = appCode.trim();
  if (!code) throw new Error('缺少 app_code');
  return runSiteapp(['siteapp', 'source', 'download'], {
    extraArgs: ['--app_code', code],
  });
}

/** Matches sai-cli timestamp style with seconds to avoid same-minute version collisions. */
export function buildDefaultDeploymentVersion(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${y}.${m}.${d}.${hh}${mm}${ss}`;
}

export function resolveSiteappDeployCreateParams(input: {
  appCode: string;
  env: string;
  requestId?: string;
  deploymentVersion?: string;
}): Record<string, string> {
  const appCode = input.appCode.trim();
  if (!appCode) throw new Error('缺少 app_code');
  const env = input.env.trim();
  if (!env) throw new Error('缺少 env');
  return {
    app_code: appCode,
    env,
    request_id: input.requestId?.trim() || createUlid(),
    deployment_version: input.deploymentVersion?.trim() || buildDefaultDeploymentVersion(),
  };
}

export async function siteappDeployCreate(input: {
  appCode: string;
  env: string;
  requestId?: string;
  deploymentVersion?: string;
}) {
  const appCode = input.appCode.trim();
  if (!appCode) return { ok: false, error: '缺少 app_code', exitCode: 1 };
  const params = resolveSiteappDeployCreateParams(input);
  logger.info(
    `[siteapp] deploy create appCode=${appCode} env=${params.env} ` +
    `requestId=${params.request_id} deploymentVersion=${params.deployment_version}`,
  );
  return runSiteapp(['siteapp', 'deploy', 'create'], { params, timeoutMs: 120_000 });
}

export async function siteappDeployRefresh(input: {
  appCode: string;
  deploymentId: string;
}) {
  const appCode = input.appCode.trim();
  const deploymentId = input.deploymentId.trim();
  if (!appCode || !deploymentId) {
    return { ok: false, error: '缺少 app_code 或 deployment_id', exitCode: 1 };
  }
  logger.info(`[siteapp] deploy refresh appCode=${appCode} deploymentId=${deploymentId}`);
  return runSiteapp(['siteapp', 'deploy', 'refresh'], {
    params: { app_code: appCode, deployment_id: deploymentId },
    timeoutMs: 120_000,
  });
}

export async function siteappDeployResourceList(input: {
  appCode: string;
  pipelineInstanceId: string | number;
}) {
  const appCode = input.appCode.trim();
  const pipelineInstanceId = Number(input.pipelineInstanceId);
  if (!appCode || !Number.isSafeInteger(pipelineInstanceId) || pipelineInstanceId <= 0) {
    return {
      ok: false,
      error: '缺少有效的 app_code 或 pipeline_instance_id',
      exitCode: 1,
    };
  }
  logger.info(
    `[siteapp] deploy-resource list appCode=${appCode} pipelineInstanceId=${pipelineInstanceId}`,
  );
  return runSiteapp(['siteapp', 'deploy-resource', 'list'], {
    params: { app_code: appCode, pipeline_instance_id: pipelineInstanceId },
    timeoutMs: 60_000,
  });
}

export async function siteappMenuList(appCode: string) {
  const code = appCode.trim();
  if (!code) return { ok: false, error: '缺少 app_code', exitCode: 1 };
  logger.info(`[siteapp] menu list appCode=${code}`);
  return runSiteapp(['siteapp', 'menu', 'list'], {
    params: { app_code: code },
  });
}

export async function siteappMenuSync(params: Record<string, unknown>) {
  const appCode = typeof params.app_code === 'string' ? params.app_code.trim() : '';
  if (!appCode) return { ok: false, error: '缺少 app_code', exitCode: 1 };
  logger.info(`[siteapp] menu sync appCode=${appCode} mode=${String(params.mode ?? '')}`);
  return runSiteapp(['siteapp', 'menu', 'sync'], { params, timeoutMs: 60_000 });
}

export function parseSiteappUploadRevision(data: unknown) {
  return parseSiteappRevision(data);
}
