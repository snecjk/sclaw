/**
 * sto-app CLI wrapper for user-app collaboration.
 * Shared by UI buttons now, and by agent-driven actions later.
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { logger } from '../utils/logger';

export interface StoAppCommandResult {
  ok: boolean;
  output: string;
  json?: unknown;
}

export interface StoAppStatusSummary {
  available: boolean;
  executable: string | null;
  bound: boolean;
  syncState: 'unbound' | 'synced' | 'local-changes' | 'remote-ahead' | 'merge-required' | 'unknown';
  syncLabel: string;
  applicationId?: string;
  applicationName?: string;
  revisionId?: string;
  devCommitSha?: string;
  raw?: unknown;
}

function summarizeOutput(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '(empty)';
  return normalized.length > 500 ? `${normalized.slice(0, 500)}...` : normalized;
}

function stoAppCandidates(): string[] {
  const home = homedir();
  const isWin = process.platform === 'win32';
  return isWin
    ? [
      join(home, 'AppData', 'Local', 'sto-app', 'sto-app.cmd'),
      'sto-app',
    ]
    : [
      join(home, '.local', 'share', 'sto-app', 'sto-app'),
      join(home, '.local', 'bin', 'sto-app'),
      'sto-app',
    ];
}

export function resolveStoAppExecutable(): string | null {
  for (const candidate of stoAppCandidates()) {
    if (candidate === 'sto-app') return candidate;
    if (existsSync(candidate)) return candidate;
  }
  return 'sto-app';
}

function readJsonObject(input: string): Record<string, unknown> | null {
  const text = input.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function detectSyncState(data: Record<string, unknown> | null): StoAppStatusSummary['syncState'] {
  if (!data) return 'unknown';
  const candidates = [
    data.syncState,
    data.status,
    data.state,
    data.code,
  ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().toUpperCase());

  if (candidates.some((item) => item.includes('MERGE') || item.includes('CONFLICT'))) return 'merge-required';
  if (candidates.some((item) => item.includes('REMOTE_AHEAD'))) return 'remote-ahead';
  if (candidates.some((item) => item.includes('LOCAL') || item.includes('DIRTY') || item.includes('AHEAD'))) return 'local-changes';
  if (candidates.some((item) => item.includes('BOUND') || item.includes('SYNCED') || item.includes('OK') || item.includes('CLEAN'))) return 'synced';
  if (data.bound === false || data.isBound === false) return 'unbound';
  return 'unknown';
}

function syncLabelForState(state: StoAppStatusSummary['syncState'], bound: boolean): string {
  if (!bound) return '未绑定';
  switch (state) {
    case 'synced':
      return '已同步';
    case 'local-changes':
      return '本地有改动';
    case 'remote-ahead':
      return '远端有更新';
    case 'merge-required':
      return '需要合并';
    default:
      return '状态未知';
  }
}

async function runStoApp(
  args: string[],
  cwd: string,
): Promise<StoAppCommandResult> {
  const command = resolveStoAppExecutable();
  if (!command) {
    logger.warn('[sto-app] executable not found');
    return { ok: false, output: 'sto-app CLI 不存在' };
  }

  logger.info(`[sto-app] spawn command=${command} cwd=${cwd} args=${JSON.stringify(args)}`);

  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      env: process.env,
    });
    const chunks: string[] = [];
    const onData = (chunk: unknown) => {
      chunks.push(String(chunk));
      if (chunks.length > 120) chunks.shift();
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (error) => {
      logger.error(`[sto-app] spawn error command=${command} cwd=${cwd}: ${error.message}`);
      resolvePromise({ ok: false, output: error.message });
    });
    child.on('close', (code) => {
      const output = chunks.join('').trim();
      const json = readJsonObject(output) ?? undefined;
      logger.info(
        `[sto-app] exit code=${code ?? -1} ok=${code === 0} command=${command} ` +
        `cwd=${cwd} output=${summarizeOutput(output)} json=${json ? 'yes' : 'no'}`,
      );
      resolvePromise({
        ok: code === 0,
        output,
        json,
      });
    });
  });
}

export async function getStoAppStatus(appPath: string): Promise<StoAppStatusSummary> {
  const cwd = resolve(appPath);
  logger.info(`[sto-app] action=status appPath=${cwd}`);
  const result = await runStoApp(['status', '--json'], cwd);
  const data = result.json && typeof result.json === 'object'
    ? result.json as Record<string, unknown>
    : null;
  const bound = Boolean(
    data?.bound === true
    || data?.isBound === true
    || data?.applicationId
    || data?.appId,
  );
  const syncState = bound ? detectSyncState(data) : 'unbound';
  const summary = {
    available: result.ok || !/not found|enoent/i.test(result.output),
    executable: resolveStoAppExecutable(),
    bound,
    syncState,
    syncLabel: syncLabelForState(syncState, bound),
    applicationId: typeof data?.applicationId === 'string'
      ? data.applicationId
      : typeof data?.appId === 'string'
        ? data.appId
        : undefined,
    applicationName: typeof data?.applicationName === 'string'
      ? data.applicationName
      : typeof data?.name === 'string'
        ? data.name
        : undefined,
    revisionId: typeof data?.revisionId === 'string' ? data.revisionId : undefined,
    devCommitSha: typeof data?.devCommitSha === 'string' ? data.devCommitSha : undefined,
    raw: data ?? result.output,
  };
  logger.info(
    `[sto-app] action=status result available=${summary.available} bound=${summary.bound} ` +
    `syncState=${summary.syncState} appId=${summary.applicationId ?? '-'} ` +
    `revision=${summary.revisionId ?? '-'} cwd=${cwd}`,
  );
  return summary;
}

export async function createStoApp(
  appPath: string,
  input: { name: string; description?: string; message?: string },
): Promise<StoAppCommandResult> {
  const cwd = resolve(appPath);
  const name = input.name.trim();
  logger.info(
    `[sto-app] action=create appPath=${cwd} name=${name} ` +
    `hasDescription=${Boolean(input.description?.trim())} hasMessage=${Boolean(input.message?.trim())}`,
  );
  const args = ['apps', 'create', name, '--path', cwd, '--json'];
  if (input.description?.trim()) {
    args.push('--description', input.description.trim());
  }
  if (input.message?.trim()) {
    args.push('--message', input.message.trim());
  }
  const result = await runStoApp(args, cwd);
  if (!result.ok) {
    throw new Error(result.output || 'sto-app 创建应用失败');
  }
  logger.info(`[sto-app] action=create success name=${name} appPath=${cwd}`);
  return result;
}

export async function pushStoApp(
  appPath: string,
  message: string,
): Promise<StoAppCommandResult> {
  const cwd = resolve(appPath);
  const trimmed = message.trim() || '更新应用';
  logger.info(`[sto-app] action=push appPath=${cwd} message=${JSON.stringify(trimmed)}`);

  // Always pull first when bound; surface remote/merge errors instead of force-writing.
  const pull = await runStoApp(['pull', '--json'], cwd);
  if (!pull.ok) {
    const data = pull.json && typeof pull.json === 'object'
      ? pull.json as Record<string, unknown>
      : null;
    const syncState = detectSyncState(data);
    if (syncState === 'merge-required' || syncState === 'remote-ahead') {
      throw new Error(pull.output || '远端有更新或存在冲突，请先处理后再提交');
    }
    // Some CLIs return non-zero when already up to date — continue only if JSON looks clean.
    if (!data || detectSyncState(data) === 'unknown') {
      logger.warn(`[sto-app] action=pull-before-push soft-fail output=${summarizeOutput(pull.output)}`);
    } else if (syncState !== 'synced' && syncState !== 'local-changes') {
      throw new Error(pull.output || '拉取远端失败，无法提交');
    }
  }

  const result = await runStoApp(['push', '--message', trimmed, '--json'], cwd);
  if (!result.ok) {
    throw new Error(result.output || 'sto-app 提交失败');
  }
  logger.info(`[sto-app] action=push success appPath=${cwd}`);
  return result;
}

export async function pullStoApp(appPath: string): Promise<StoAppCommandResult> {
  const cwd = resolve(appPath);
  logger.info(`[sto-app] action=pull appPath=${cwd}`);
  const result = await runStoApp(['pull', '--json'], cwd);
  if (!result.ok) {
    throw new Error(result.output || 'sto-app 拉取失败');
  }
  logger.info(`[sto-app] action=pull success appPath=${cwd}`);
  return result;
}

export async function continueStoAppMerge(
  appPath: string,
  revisionId: string,
): Promise<StoAppCommandResult> {
  const cwd = resolve(appPath);
  const trimmed = revisionId.trim();
  if (!trimmed) throw new Error('缺少 revisionId');
  logger.info(`[sto-app] action=merge-continue appPath=${cwd} revisionId=${trimmed}`);
  const result = await runStoApp(['merge', 'continue', '--remote', trimmed, '--json'], cwd);
  if (!result.ok) {
    throw new Error(result.output || 'sto-app 合并继续失败');
  }
  logger.info(`[sto-app] action=merge-continue success appPath=${cwd} revisionId=${trimmed}`);
  return result;
}

export interface StoCloudApp {
  applicationId: string;
  applicationName: string;
  raw?: unknown;
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function normalizeCloudApp(item: unknown): StoCloudApp | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as Record<string, unknown>;
  const applicationId = pickString(
    row.applicationId,
    row.appId,
    row.id,
    row.application_id,
  );
  if (!applicationId) return null;
  const applicationName = pickString(
    row.applicationName,
    row.name,
    row.title,
    row.appName,
  ) ?? applicationId;
  return { applicationId, applicationName, raw: item };
}

function extractCloudAppList(json: unknown): StoCloudApp[] {
  if (!json) return [];
  if (Array.isArray(json)) {
    return json.map(normalizeCloudApp).filter((item): item is StoCloudApp => Boolean(item));
  }
  if (typeof json !== 'object') return [];
  const root = json as Record<string, unknown>;
  const candidates = [root.apps, root.items, root.data, root.list, root.applications];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map(normalizeCloudApp).filter((item): item is StoCloudApp => Boolean(item));
    }
    if (candidate && typeof candidate === 'object') {
      const nested = candidate as Record<string, unknown>;
      const nestedList = nested.apps ?? nested.items ?? nested.list;
      if (Array.isArray(nestedList)) {
        return nestedList.map(normalizeCloudApp).filter((item): item is StoCloudApp => Boolean(item));
      }
    }
  }
  return [];
}

export async function listStoApps(): Promise<{
  ok: boolean;
  apps: StoCloudApp[];
  output: string;
}> {
  const cwd = homedir();
  logger.info('[sto-app] action=list');
  const result = await runStoApp(['apps', 'list', '--json'], cwd);
  const apps = extractCloudAppList(result.json);
  logger.info(`[sto-app] action=list ok=${result.ok} count=${apps.length}`);
  return { ok: result.ok, apps, output: result.output };
}

export async function cloneStoApp(
  applicationId: string,
  targetDir: string,
): Promise<StoAppCommandResult> {
  const id = applicationId.trim();
  const target = resolve(targetDir.trim());
  if (!id) throw new Error('缺少 applicationId');
  if (!target) throw new Error('缺少目标目录');
  logger.info(`[sto-app] action=clone applicationId=${id} targetDir=${target}`);
  const result = await runStoApp(['clone', id, target, '--json'], homedir());
  if (!result.ok) {
    throw new Error(result.output || 'sto-app 拉取应用失败');
  }
  logger.info(`[sto-app] action=clone success applicationId=${id} targetDir=${target}`);
  return result;
}

/** Best-effort extract applicationId from create/clone CLI JSON. */
export function extractApplicationId(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const row = json as Record<string, unknown>;
  return pickString(
    row.applicationId,
    row.appId,
    row.id,
    (row.app as Record<string, unknown> | undefined)?.applicationId,
    (row.app as Record<string, unknown> | undefined)?.id,
    (row.data as Record<string, unknown> | undefined)?.applicationId,
    (row.data as Record<string, unknown> | undefined)?.id,
  );
}
