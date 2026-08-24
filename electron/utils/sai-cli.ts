/**
 * SAI CLI bridge — spawn sai binary from Electron main process
 *
 * Provides a thin wrapper around the SAI CLI binary so the renderer
 * can discover and execute dynamic commands through the existing
 * IPC / unified-request layer.
 *
 * SAI CLI is managed via online update API (/api/v1/cli/update).
 * No bundled binary is shipped with the app anymore.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  chmodSync,
  readFileSync,
  appendFileSync,
  renameSync,
  unlinkSync,
  createWriteStream,
} from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { logger } from './logger';
import { resolveStoBaseUrl } from './sto-domain';
import { proxyAwareFetch } from './proxy-fetch';
import { SAI_CLIENT_ID_VALUE } from './sai-client-id';

export interface SaiCliResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  exitCode: number;
}

interface SaiCliUpdateInfo {
  latestVersion: string;
  downloadUrl: string;
  releaseNotes?: string;
  sha256?: string;
  forceUpdate?: boolean;
  publishedAt?: string;
}

function resolveSaiBinary(): string | null {
  const platform = process.platform;
  const binaryName = platform === 'win32' ? 'sai-cli.exe' : 'sai-cli';

  // 1. ~/.sai/bin/sai-cli (SAI CLI standard install path)
  const userBin = join(homedir(), '.sai', 'bin', binaryName);
  if (existsSync(userBin)) return userBin;

  // 2. Let shell resolve via PATH
  return binaryName;
}

/** sai-cli 访问命令注册中心的 HTTP 超时（默认 15s 对大页 list 偏紧）。 */
export const SAI_REGISTRY_REQUEST_TIMEOUT_MS = 60_000;

/** list / discover 子进程超时：略高于注册中心 HTTP 超时。 */
export const SAI_LIST_SPAWN_TIMEOUT_MS = 75_000;

function runSai(
  args: string[],
  timeoutMs = 30000,
  options?: { registryRequestTimeoutMs?: number },
): Promise<SaiCliResult> {
  const binary = resolveSaiBinary();
  if (!binary) {
    return Promise.resolve({
      ok: false,
      error: 'SAI CLI not found. Install it first.',
      exitCode: -1,
    });
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SAI_OUTPUT: 'json',
    SAI_CLIENT_ID: SAI_CLIENT_ID_VALUE,
  };
  if (
    typeof options?.registryRequestTimeoutMs === 'number'
    && Number.isFinite(options.registryRequestTimeoutMs)
    && options.registryRequestTimeoutMs > 0
  ) {
    env.SAI_REGISTRY_REQUEST_TIMEOUT_MS = String(Math.floor(options.registryRequestTimeoutMs));
  }

  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      resolve({
        ok: false,
        error: `Failed to spawn SAI CLI: ${err.message}`,
        exitCode: -1,
      });
    });

    child.on('close', (code) => {
      // SAI CLI outputs JSON envelope as the last line:
      // {"ok":true,"data":...} or {"ok":false,"error":...}
      const lastLine = stdout.trim().split('\n').pop() || '{}';
      try {
        const parsed = JSON.parse(lastLine);
        if (parsed && typeof parsed.ok === 'boolean') {
          resolve({ ...parsed, exitCode: code ?? 0 });
          return;
        }
      } catch {
        // Not a JSON envelope — fall through to raw output handling
      }

      if (code === 0) {
        resolve({ ok: true, data: stdout.trim() || undefined, exitCode: 0 });
      } else {
        resolve({
          ok: false,
          error: stderr.trim() || stdout.trim() || `exit code ${code}`,
          exitCode: code ?? 1,
        });
      }
    });
  });
}

// ── Basic commands ──────────────────────────────────────────────────────────

export async function saiVersion(): Promise<SaiCliResult> {
  return runSai(['version', '--json']);
}

export async function saiWhoami(): Promise<SaiCliResult> {
  return runSai(['whoami']);
}

export async function saiDiscover(
  query?: string,
  options?: { limit?: number },
): Promise<SaiCliResult> {
  const trimmed = query?.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: 'discover query is required',
      exitCode: 1,
    };
  }
  const args = ['discover', trimmed];
  const limit = options?.limit;
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    args.push('--limit', String(Math.floor(limit)));
  }
  return runSai(args, SAI_LIST_SPAWN_TIMEOUT_MS, {
    registryRequestTimeoutMs: SAI_REGISTRY_REQUEST_TIMEOUT_MS,
  });
}

export async function saiList(options?: {
  product?: string;
  module?: string;
  page?: number;
  pageSize?: number;
}): Promise<SaiCliResult> {
  const args = ['list'];
  if (options?.product) args.push('--product', options.product);
  if (options?.module) args.push('--module', options.module);
  if (typeof options?.page === 'number' && Number.isFinite(options.page) && options.page > 0) {
    args.push('--page', String(Math.floor(options.page)));
  }
  if (
    typeof options?.pageSize === 'number'
    && Number.isFinite(options.pageSize)
    && options.pageSize > 0
  ) {
    args.push('--page-size', String(Math.floor(options.pageSize)));
  }
  return runSai(args, SAI_LIST_SPAWN_TIMEOUT_MS, {
    registryRequestTimeoutMs: SAI_REGISTRY_REQUEST_TIMEOUT_MS,
  });
}

/** 翻页拉全量 list（默认每页 100；CLI 无业务搜索词参数）。 */
export async function saiListAll(options?: {
  product?: string;
  module?: string;
  pageSize?: number;
}): Promise<SaiCliResult> {
  const pageSize = Math.min(
    Math.max(Math.floor(options?.pageSize ?? 100), 1),
    100,
  );
  const commands: unknown[] = [];
  let total = Number.POSITIVE_INFINITY;
  let lastData: Record<string, unknown> | null = null;

  for (let page = 1; page <= 50; page += 1) {
    const result = await saiList({
      product: options?.product,
      module: options?.module,
      page,
      pageSize,
    });
    if (!result.ok) return result;

    const data = (result.data && typeof result.data === 'object')
      ? (result.data as Record<string, unknown>)
      : {};
    lastData = data;
    const pageCommands = Array.isArray(data.commands)
      ? data.commands
      : Array.isArray(data.items)
        ? data.items
        : [];
    commands.push(...pageCommands);

    if (typeof data.total === 'number' && Number.isFinite(data.total)) {
      total = data.total;
    } else if (pageCommands.length < pageSize) {
      total = commands.length;
    }

    if (commands.length >= total || pageCommands.length === 0) break;
  }

  return {
    ok: true,
    data: {
      ...(lastData ?? {}),
      commands,
      count: commands.length,
      page: 1,
      pageSize: commands.length,
      total: typeof lastData?.total === 'number' ? lastData.total : commands.length,
    },
    exitCode: 0,
  };
}

// ── Dynamic command execution ───────────────────────────────────────────────

// SAI CLI 命令黑名单：禁止通过对话触发的安装/卸载类操作
// update/upgrade 已放行：sai-cli 是独立二进制，更新不会影响 Gateway
const BLOCKED_SAI_COMMANDS: RegExp[] = [
  /^install/i,
  /^uninstall/i,
  /^remove/i,
];

function getBlockedSaiErrorMessage(commandPath: string): string | null {
  const firstSegment = commandPath.split('/')[0] || '';
  for (const pattern of BLOCKED_SAI_COMMANDS) {
    if (pattern.test(firstSegment)) {
      return `系统安全策略已阻止该操作：暂不支持通过对话执行 "${commandPath}" 命令。`;
    }
  }
  return null;
}

export async function saiExecute(
  commandPath: string,
  params?: Record<string, unknown>,
): Promise<SaiCliResult> {
  const blockedMsg = getBlockedSaiErrorMessage(commandPath);
  if (blockedMsg) {
    return {
      ok: false,
      error: blockedMsg,
      exitCode: 1,
    };
  }

  const args = commandPath.split('/');
  if (params && Object.keys(params).length > 0) {
    args.push('--params', JSON.stringify(params));
  }
  return runSai(args, 60000);
}

export type CodeDeployEnv = 'daily' | 'stage' | 'online';

function saiCodeDeployError(message: string): SaiCliResult {
  return { ok: false, error: message, exitCode: 1 };
}

/**
 * Deploy a STO code app via policy CLI:
 * `sai-cli policy code-deploy create --env ... --applicationId ...`
 */
export async function saiCodeDeployCreate(input: {
  env: CodeDeployEnv;
  applicationId: string;
  requestId?: string;
  deploymentVersion?: string;
}): Promise<SaiCliResult> {
  const applicationId = input.applicationId.trim();
  const env = input.env;
  if (!applicationId) return saiCodeDeployError('缺少 applicationId');
  if (env !== 'daily' && env !== 'stage' && env !== 'online') {
    return saiCodeDeployError('env 必须是 daily / stage / online');
  }

  const args = [
    'policy',
    'code-deploy',
    'create',
    '--env',
    env,
    '--applicationId',
    applicationId,
  ];
  if (input.requestId?.trim()) {
    args.push('--requestId', input.requestId.trim());
  }
  if (input.deploymentVersion?.trim()) {
    args.push('--deploymentVersion', input.deploymentVersion.trim());
  }

  logger.info(
    `[sai-cli] action=code-deploy-create env=${env} applicationId=${applicationId} ` +
    `requestId=${input.requestId?.trim() || '-'} deploymentVersion=${input.deploymentVersion?.trim() || '-'}`,
  );
  const result = await runSai(args, 120_000);
  logger.info(
    `[sai-cli] action=code-deploy-create done ok=${result.ok} exitCode=${result.exitCode} ` +
    `error=${result.error ?? '-'}`,
  );
  if (result.ok) {
    const preview = (() => {
      try {
        return JSON.stringify(result.data)?.slice(0, 500) ?? '-';
      } catch {
        return '-';
      }
    })();
    logger.info(`[sai-cli] action=code-deploy-create dataPreview=${preview}`);
  }
  return result;
}

/** Sync latest DevOps pipeline status into the local deploy record. */
export async function saiCodeDeployRefresh(input: {
  deploymentId: string;
}): Promise<SaiCliResult> {
  const deploymentId = input.deploymentId.trim();
  if (!deploymentId) return saiCodeDeployError('缺少 deploymentId');

  logger.info(`[sai-cli] action=code-deploy-refresh deploymentId=${deploymentId}`);
  const result = await runSai(
    ['policy', 'code-deploy', 'refresh', '--deploymentId', deploymentId],
    120_000,
  );
  logger.info(
    `[sai-cli] action=code-deploy-refresh done ok=${result.ok} exitCode=${result.exitCode} ` +
    `error=${result.error ?? '-'}`,
  );
  return result;
}

/** Read local cached deploy detail (does not refresh from DevOps). */
export async function saiCodeDeployDetail(input: {
  deploymentId: string;
}): Promise<SaiCliResult> {
  const deploymentId = input.deploymentId.trim();
  if (!deploymentId) return saiCodeDeployError('缺少 deploymentId');
  return runSai(
    ['policy', 'code-deploy', 'detail', '--deploymentId', deploymentId],
    60_000,
  );
}

export async function saiCodeDeployList(input: {
  applicationId: string;
  limit?: number;
}): Promise<SaiCliResult> {
  const applicationId = input.applicationId.trim();
  if (!applicationId) return saiCodeDeployError('缺少 applicationId');
  const args = ['policy', 'code-deploy', 'list', '--applicationId', applicationId];
  if (typeof input.limit === 'number' && Number.isFinite(input.limit)) {
    args.push('--limit', String(Math.max(1, Math.min(100, Math.floor(input.limit)))));
  }
  return runSai(args, 60_000);
}

export async function saiCodeDeployRetry(input: {
  deploymentId: string;
}): Promise<SaiCliResult> {
  const deploymentId = input.deploymentId.trim();
  if (!deploymentId) return saiCodeDeployError('缺少 deploymentId');
  logger.info(`[sai-cli] action=code-deploy-retry deploymentId=${deploymentId}`);
  const result = await runSai(
    ['policy', 'code-deploy', 'retry', '--deploymentId', deploymentId],
    120_000,
  );
  logger.info(
    `[sai-cli] action=code-deploy-retry done ok=${result.ok} exitCode=${result.exitCode} ` +
    `error=${result.error ?? '-'}`,
  );
  return result;
}

// ── Installation detection ──────────────────────────────────────────────────

export async function saiCheckInstalled(): Promise<{
  installed: boolean;
  version?: string;
  path?: string;
}> {
  const binary = resolveSaiBinary();
  const result = await saiVersion();

  if (!result.ok) {
    return { installed: false };
  }

  const versionStr =
    typeof result.data === 'object' && result.data !== null
      ? (result.data as Record<string, unknown>).version
      : undefined;

  return {
    installed: true,
    version: typeof versionStr === 'string' ? versionStr : undefined,
    path: binary ?? undefined,
  };
}

// ── Online update via API ───────────────────────────────────────────────────

function getSaiInstallTarget(): string {
  const binName = process.platform === 'win32' ? 'sai-cli.exe' : 'sai-cli';
  return join(homedir(), '.sai', 'bin', binName);
}

async function getSaiCliUpdateBaseUrl(): Promise<string> {
  return resolveStoBaseUrl();
}

async function fetchLatestSaiCliInfo(currentVersion: string): Promise<SaiCliUpdateInfo | null> {
  const baseUrl = await getSaiCliUpdateBaseUrl();
  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const url = `${baseUrl}/api/v1/cli/update?os=${platform}&arch=${arch}&currentVersion=${encodeURIComponent(currentVersion)}`;

  const response = await proxyAwareFetch(url, { timeoutMs: 15_000 });

  if (!response.ok) {
    if (response.status === 404) {
      logger.info('No sai-cli update available for', platform, arch);
      return null;
    }
    throw new Error(`sai-cli update API returned HTTP ${response.status}`);
  }

  return (await response.json()) as SaiCliUpdateInfo;
}

async function downloadFile(url: string, targetPath: string, expectedSha256?: string): Promise<void> {
  const response = await proxyAwareFetch(url, { timeoutMs: 120_000 });

  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }

  const tmpPath = `${targetPath}.download-${Date.now()}`;
  try {
    await pipeline(
      Readable.fromWeb(response.body as any),
      createWriteStream(tmpPath),
    );

    if (expectedSha256) {
      const hash = createHash('sha256');
      hash.update(await readFile(tmpPath));
      const actualSha256 = hash.digest('hex');
      if (actualSha256 !== expectedSha256) {
        throw new Error(`SHA256 mismatch: expected ${expectedSha256}, got ${actualSha256}`);
      }
    }

    renameSync(tmpPath, targetPath);
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore
    }
    throw error;
  }
}

async function getLocalSaiCliVersionInfo(): Promise<{ version?: string; path?: string }> {
  const binary = resolveSaiBinary();
  if (!binary || binary === 'sai-cli' || binary === 'sai-cli.exe') {
    return {};
  }

  const result = await saiVersion();
  if (!result.ok) return {};

  const versionStr =
    typeof result.data === 'object' && result.data !== null
      ? (result.data as Record<string, unknown>).version
      : undefined;

  return {
    version: typeof versionStr === 'string' ? versionStr : undefined,
    path: binary,
  };
}

export async function checkSaiCliUpdate(): Promise<{
  hasUpdate: boolean;
  currentVersion?: string;
  latestVersion?: string;
  releaseNotes?: string;
  forceUpdate?: boolean;
}> {
  const localInfo = await getLocalSaiCliVersionInfo();
  if (!localInfo.version) {
    return { hasUpdate: true };
  }

  const remoteInfo = await fetchLatestSaiCliInfo(localInfo.version);
  if (!remoteInfo) {
    return { hasUpdate: false, currentVersion: localInfo.version };
  }

  const hasUpdate = remoteInfo.latestVersion !== localInfo.version;
  return {
    hasUpdate,
    currentVersion: localInfo.version,
    latestVersion: remoteInfo.latestVersion,
    releaseNotes: remoteInfo.releaseNotes,
    forceUpdate: remoteInfo.forceUpdate,
  };
}

export async function installOrUpdateSaiCli(
  notify?: (path: string) => void,
): Promise<{ success: boolean; path?: string; version?: string; updated?: boolean; error?: string }> {
  const target = getSaiInstallTarget();
  const localInfo = await getLocalSaiCliVersionInfo();

  let remoteInfo: SaiCliUpdateInfo | null;
  try {
    remoteInfo = await fetchLatestSaiCliInfo(localInfo.version || '0.0.0');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to fetch sai-cli update info:', msg);
    return { success: false, error: msg };
  }

  if (!remoteInfo) {
    return { success: false, error: 'No sai-cli release available for this platform.' };
  }

  if (localInfo.version === remoteInfo.latestVersion) {
    ensureSaiBinInPath();
    return { success: true, path: target, version: localInfo.version, updated: false };
  }

  try {
    mkdirSync(dirname(target), { recursive: true });

    if (process.platform === 'win32' && existsSync(target)) {
      const backupPath = `${target}.old-${Date.now()}`;
      renameSync(target, backupPath);
      try {
        unlinkSync(backupPath);
      } catch {
        // ignore
      }
    }

    await downloadFile(remoteInfo.downloadUrl, target, remoteInfo.sha256);

    if (process.platform !== 'win32') {
      chmodSync(target, 0o755);
    }

    ensureSaiBinInPath();

    logger.info(
      `SAI CLI ${localInfo.version ? 'updated' : 'installed'}: ${target} -> ${remoteInfo.latestVersion}`,
    );
    notify?.(target);
    return { success: true, path: target, version: remoteInfo.latestVersion, updated: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to ${localInfo.version ? 'update' : 'install'} SAI CLI:`, msg);
    return { success: false, error: msg };
  }
}

// ── PATH management ─────────────────────────────────────────────────────────

const SAI_BIN_DIR = join(homedir(), '.sai', 'bin');

/**
 * Ensure ~/.sai/bin is in the system PATH so `sai` can be invoked from
 * any shell / terminal window (including Gateway bash agents).
 *
 * - Windows: persists to the user registry PATH and broadcasts the change.
 * - macOS/Linux: appends an export line to detected shell RC files.
 */
function ensureSaiBinInPath(): void {
  const platform = process.platform;
  const pathSep = platform === 'win32' ? ';' : ':';
  const currentPath = process.env.PATH || '';

  // 1. Update the current Electron process PATH immediately so subsequent
  //    spawn() calls (including Gateway child processes) can resolve `sai`.
  const pathEntries = currentPath.split(pathSep);
  if (!pathEntries.includes(SAI_BIN_DIR)) {
    process.env.PATH = `${SAI_BIN_DIR}${pathSep}${currentPath}`;
    logger.info(`Added ${SAI_BIN_DIR} to current process PATH`);
  }

  // 2. Persist to the OS so new terminal windows also see the PATH.
  if (platform === 'win32') {
    ensureSaiBinInWindowsPath();
  } else {
    ensureSaiBinInUnixPath();
  }
}

function ensureSaiBinInWindowsPath(): void {
  try {
    const query = spawnSync('reg', [
      'query', 'HKEY_CURRENT_USER\\Environment', '/v', 'PATH',
    ], { encoding: 'utf-8', windowsHide: true });

    let userPath = '';
    if (query.status === 0) {
      const match = query.stdout.match(/PATH\s+REG_\w+\s+(.+)/);
      if (match) userPath = match[1].trim();
    }

    if (userPath.includes(SAI_BIN_DIR)) return;

    const newPath = userPath ? `${userPath};${SAI_BIN_DIR}` : SAI_BIN_DIR;
    const add = spawnSync('reg', [
      'add', 'HKEY_CURRENT_USER\\Environment', '/v', 'PATH',
      '/t', 'REG_EXPAND_SZ', '/d', newPath, '/f',
    ], { encoding: 'utf-8', windowsHide: true });

    if (add.status === 0) {
      logger.info(`Added ${SAI_BIN_DIR} to Windows user PATH`);
      broadcastWindowsEnvChange();
    } else {
      logger.warn('Failed to update Windows PATH:', add.stderr || add.stdout);
    }
  } catch (err) {
    logger.warn('Failed to update Windows PATH:', err);
  }
}

function broadcastWindowsEnvChange(): void {
  try {
    // Broadcast WM_SETTINGCHANGE so Explorer and other processes pick up
    // the new PATH without a reboot.
    spawnSync('powershell.exe', [
      '-NoProfile', '-Command',
      'Add-Type -MemberDefinition \'[DllImport("user32.dll",SetLastError=true,CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd,uint Msg,UIntPtr wParam,string lParam,uint fuFlags,uint uTimeout,out UIntPtr lpdwResult);\' -Name NativeMethods -Namespace Win32; $r = [UIntPtr]::Zero; [void][Win32.NativeMethods]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, "Environment", 2, 5000, [ref]$r)',
    ], { encoding: 'utf-8', windowsHide: true });
  } catch {
    // Best-effort broadcast — ignore failures.
  }
}

function ensureSaiBinInUnixPath(): void {
  const rcFiles = [
    join(homedir(), '.zshrc'),
    join(homedir(), '.bashrc'),
    join(homedir(), '.bash_profile'),
    join(homedir(), '.profile'),
  ];

  const exportLine = `export PATH="${SAI_BIN_DIR}:\$PATH"`;

  for (const rcFile of rcFiles) {
    try {
      if (!existsSync(rcFile)) continue;
      const content = readFileSync(rcFile, 'utf-8');
      if (content.includes(SAI_BIN_DIR)) continue;

      appendFileSync(rcFile, `\n# Added by SClaw\n${exportLine}\n`);
      logger.info(`Added ${SAI_BIN_DIR} to ${rcFile}`);
    } catch (err) {
      logger.warn(`Failed to update ${rcFile}:`, err);
    }
  }
}

// ── Public entry ────────────────────────────────────────────────────────────

/**
 * Auto-install or update SAI CLI from the online update API.
 * Called during startup so users don't need to manually install.
 */
export async function autoInstallSaiCliIfNeeded(
  notify?: (path: string) => void,
): Promise<{ success: boolean; path?: string; error?: string }> {
  const result = await installOrUpdateSaiCli(notify);
  return {
    success: result.success,
    path: result.path,
    error: result.error,
  };
}

export const SAI_POLICY_TIMEOUT_MS = 180_000;

/** Run sai-cli with JSON output; default 180s for upload/download. */
export async function runSaiPolicy(
  args: string[],
  timeoutMs = SAI_POLICY_TIMEOUT_MS,
): Promise<SaiCliResult> {
  return runSai([...args, '-f', 'json'], timeoutMs);
}
