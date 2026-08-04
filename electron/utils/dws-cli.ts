/**
 * DingTalk Workspace CLI (dws) bridge — download, install, PATH, spawn.
 *
 * Connect flow: resolve manifest (backend install spec) → download CLI + skill →
 * install binary → install skill to ~/.stoclaw/connectors/skills/{slug}/.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  chmodSync,
  cpSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  readdirSync,
  statSync,
  createWriteStream,
} from 'node:fs';
import { readFile, unlink, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { app, type BrowserWindow } from 'electron';
import { parseManagedCliInstallSpec } from '../../shared/connectors/parse-install-spec';
import type { ManagedCliInstallSpec } from '../../shared/connectors/types';
import { logger } from './logger';
import { proxyAwareFetch } from './proxy-fetch';
import { getSetting } from './store';
import { getDwsLoginManager } from './dws-login';
import { invalidateDwsStatusCache } from './dws-status-cache';
import { getConnectorSkillsCacheDir } from '../connectors/connector-skill-sync';
import { resolveConnectorInstallManifest } from '../connectors/resolve-install-manifest';
import { extractZip } from './zip-extract';
import {
  SKILLS_ZIP_ASSET_NAME,
  buildGithubDirectAssetUrl,
  getGithubRepo,
  inferAssetName,
  resolveActiveGiteeRepo,
  resolveAssetDownloadUrlWithFallback,
  resolveSha256ForDownloadUrl,
  type DwsAssetChecksumSpec,
  type DwsDownloadSourcePriority,
  type DwsPlatformAssetSpec,
  type DwsReleaseSources,
} from '../../shared/dws-release-resolver';

export interface DwsCliResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  exitCode: number;
}

export interface DwsBundledManifest {
  dwsVersion: string;
  skillMode: 'mono' | 'multi';
  skillsRevision: string;
  /** @deprecated 简单换 host 对 Gitee 无效，保留仅兼容旧 manifest */
  mirrorBaseUrl?: string | null;
  sources?: DwsReleaseSources;
  resolvedFrom?: 'github' | 'gitee';
  releaseUrl?: string | null;
  skillsZip?: {
    assetName?: string;
    url?: string | null;
    sha256?: string | null;
    githubSha256?: string | null;
  } | null;
  platforms: Record<string, DwsPlatformAssetSpec & { url?: string }>;
}

export interface DwsLocalManifest {
  dwsVersion: string;
  skillMode: string;
  skillsRevision: string;
  binaryPath: string;
  installedAt: string;
  bundledByStoClawVersion?: string;
}

export const DWS_BIN_DIR = join(homedir(), '.stoclaw', 'bin');

export function getDwsBinDir(): string {
  return DWS_BIN_DIR;
}
const DWS_STATE_DIR = join(homedir(), '.stoclaw', 'dws');
const LOCAL_MANIFEST_PATH = join(DWS_STATE_DIR, 'manifest.json');

function normalizeCliBinaryName(binary?: string): string {
  const name = (binary || 'dws').trim().replace(/\.exe$/i, '') || 'dws';
  return name.toLowerCase();
}

function getBinaryFileName(binary?: string): string {
  const name = normalizeCliBinaryName(binary);
  return process.platform === 'win32' ? `${name}.exe` : name;
}

function getInstallTarget(binary?: string): string {
  return join(DWS_BIN_DIR, getBinaryFileName(binary));
}

function getLocalManifestPath(binary?: string): string {
  const name = normalizeCliBinaryName(binary);
  if (name === 'dws') return LOCAL_MANIFEST_PATH;
  return join(homedir(), '.stoclaw', 'connectors', 'cli-state', name, 'manifest.json');
}

function getPlatformKey(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `${process.platform}-${arch}`;
}

export interface DwsInstallOptions {
  installSpec?: ManagedCliInstallSpec;
  connectorId?: string;
  skillSlug?: string;
  /** Target CLI binary name (default dws). Used for install path under ~/.stoclaw/bin. */
  binary?: string;
  onProgress?: (message: string) => void;
  notify?: (path: string) => void;
}

function normalizeDwsInstallOptions(
  options?: DwsInstallOptions | ((path: string) => void),
): DwsInstallOptions {
  if (typeof options === 'function') return { notify: options };
  return options ?? {};
}

function connectorSkillDir(slug: string): string {
  return join(getConnectorSkillsCacheDir(), slug);
}

async function resolveDwsManifest(options: DwsInstallOptions): Promise<DwsBundledManifest | null> {
  const installSpec = options.installSpec ?? parseManagedCliInstallSpec({});
  const manifest = await resolveConnectorInstallManifest({
    installSpec,
    connectorId: options.connectorId ?? 'dingtalk-dws',
  });
  const version =
    (typeof manifest?.dwsVersion === 'string' && manifest.dwsVersion.trim())
    || (typeof manifest?.version === 'string' && manifest.version.trim())
    || '';
  if (!version || !manifest?.platforms) return null;
  return { ...manifest, dwsVersion: version } as DwsBundledManifest;
}

function compareSemver(a: string, b: string): number {
  const pa = normalizeDwsVersion(a).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const pb = normalizeDwsVersion(b).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db ? 1 : -1;
  }
  return 0;
}

/** dws CLI 返回的 version 常带 v 前缀，统一去掉后再展示/比较。 */
export function normalizeDwsVersion(version: string): string {
  return version.trim().replace(/^v+/i, '');
}

export function resolveDwsBinary(): string | null {
  const target = getInstallTarget('dws');
  if (existsSync(target)) return target;
  return getBinaryFileName('dws');
}

function parseDwsJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  const lines = trimmed.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim();
    if (!line?.startsWith('{') && !line?.startsWith('[')) continue;
    try {
      return JSON.parse(line);
    } catch {
      // continue
    }
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

export function runDws(args: string[], timeoutMs = 30_000): Promise<DwsCliResult> {
  const binary = resolveDwsBinary();
  if (!binary) {
    return Promise.resolve({
      ok: false,
      error: 'dws not found. Install it first.',
      exitCode: -1,
    });
  }

  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      env: { ...process.env, DWS_OUTPUT: 'json' },
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
        error: `Failed to spawn dws: ${err.message}`,
        exitCode: -1,
      });
    });

    child.on('close', (code) => {
      const parsed = parseDwsJson(stdout);
      if (parsed && typeof parsed === 'object' && parsed !== null && 'ok' in parsed) {
        const envelope = parsed as { ok: boolean; data?: unknown; error?: string };
        resolve({
          ok: envelope.ok,
          data: envelope.data,
          error: envelope.error,
          exitCode: code ?? (envelope.ok ? 0 : 1),
        });
        return;
      }

      if (code === 0) {
        resolve({ ok: true, data: parsed ?? (stdout.trim() || undefined), exitCode: 0 });
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

function readLocalManifest(binary?: string): DwsLocalManifest | null {
  const path = getLocalManifestPath(binary);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as DwsLocalManifest;
  } catch {
    return null;
  }
}

function writeLocalManifest(manifest: DwsLocalManifest, binary?: string): void {
  const path = getLocalManifestPath(binary);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2), 'utf-8');
}

async function downloadDwsReleaseAsset(
  bundled: DwsBundledManifest,
  assetName: string,
  platformSpec: DwsPlatformAssetSpec | null,
  targetPath: string,
  checksumSpec?: DwsAssetChecksumSpec | null,
  sourcePriority?: DwsDownloadSourcePriority[],
): Promise<void> {
  const resolved = await resolveAssetDownloadUrlWithFallback({
    manifest: bundled,
    version: bundled.dwsVersion,
    assetName,
    platformSpec,
    fetchFn: proxyAwareFetch,
    sourcePriority,
  });

  if (resolved.fallbackFrom === 'gitee') {
    logger.warn(`Gitee dws unavailable, switched to GitHub: ${resolved.githubRepo}`);
  } else if (resolved.source === 'gitee') {
    logger.info(`Using Gitee dws mirror: ${resolved.giteeRepo ?? resolveActiveGiteeRepo(bundled)}`);
  }

  const githubRepo = getGithubRepo(bundled);
  const githubUrl = buildGithubDirectAssetUrl(githubRepo, bundled.dwsVersion, assetName);

  try {
    await downloadFile(
      resolved.url,
      targetPath,
      resolveSha256ForDownloadUrl(resolved.url, checksumSpec),
    );
    return;
  } catch (primaryError) {
    if (resolved.source !== 'gitee' || resolved.fallbackFrom) throw primaryError;
    logger.warn('Gitee dws asset download failed, retrying via GitHub:', primaryError);
    await downloadFile(
      githubUrl,
      targetPath,
      resolveSha256ForDownloadUrl(githubUrl, checksumSpec),
    );
  }
}

/** CLI / skill 包体积大、网络不稳定时下载可能很慢；仅限制“建连/首包”，不限制整包落盘。 */
const DWS_DOWNLOAD_CONNECT_TIMEOUT_MS = 120_000;

async function downloadFile(url: string, targetPath: string, expectedSha256?: string | null): Promise<void> {
  // 首包超时 2 分钟；拿到 Response 后 timeout 会释放，body 流式落盘不再被 Abort。
  const response = await proxyAwareFetch(url, { timeoutMs: DWS_DOWNLOAD_CONNECT_TIMEOUT_MS });
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }

  const tmpPath = `${targetPath}.download-${Date.now()}`;
  try {
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
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

function findBinaryInDir(dir: string, binary?: string): string | null {
  const expected = getBinaryFileName(binary);
  const base = normalizeCliBinaryName(binary);
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      const nested = findBinaryInDir(full, binary);
      if (nested) return nested;
      continue;
    }
    if (
      entry === expected
      || entry === base
      || entry === `${base}.exe`
      || (base === 'dws' && (entry === 'dws' || entry === 'dws.exe'))
    ) {
      return full;
    }
  }
  return null;
}

async function extractArchive(archivePath: string, destDir: string, archiveType: 'tar.gz' | 'zip'): Promise<void> {
  if (archiveType === 'zip') {
    await extractZip(archivePath, destDir);
    return;
  }

  const result = spawnSync('tar', ['-xzf', archivePath, '-C', destDir], { encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'tar extract failed');
  }
}

function clearMacQuarantine(binaryPath: string): void {
  if (process.platform !== 'darwin') return;
  try {
    spawnSync('xattr', ['-d', 'com.apple.quarantine', binaryPath], { encoding: 'utf-8' });
  } catch {
    // best-effort
  }
}

function getDwsConnectorSkillDir(slug: string): string {
  return connectorSkillDir(slug);
}

async function installMonoDwsSkillFromReleaseZip(
  bundled: DwsBundledManifest,
  skillSlug: string,
  installSpec?: ManagedCliInstallSpec,
  onProgress?: (message: string) => void,
): Promise<void> {
  const skillsAssetName = bundled.skillsZip?.assetName || SKILLS_ZIP_ASSET_NAME;
  const skillDir = getDwsConnectorSkillDir(skillSlug);
  const tmpDir = await mkdtemp(join(tmpdir(), 'stoclaw-dws-skill-'));
  const zipPath = join(tmpDir, 'dws-skills.zip');
  const extractDir = join(tmpDir, 'extract');

  try {
    onProgress?.('正在下载 skill…');
    await downloadDwsReleaseAsset(
      bundled,
      skillsAssetName,
      bundled.skillsZip?.url ? { url: bundled.skillsZip.url, assetName: skillsAssetName } : null,
      zipPath,
      bundled.skillsZip,
      installSpec?.sourcePriority,
    );
    onProgress?.('正在安装 skill…');
    mkdirSync(extractDir, { recursive: true });
    await extractArchive(zipPath, extractDir, 'zip');

    mkdirSync(getConnectorSkillsCacheDir(), { recursive: true });
    rmSync(skillDir, { recursive: true, force: true });
    cpSync(extractDir, skillDir, { recursive: true });

    if (!existsSync(join(skillDir, 'SKILL.md'))) {
      throw new Error('dws skill install failed: SKILL.md missing after extract');
    }
  } finally {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

/** Install dws skill package into connector skill cache (connect flow). */
export async function installDwsSkillPackageToConnectorCache(options: {
  manifest: DwsBundledManifest;
  skillSlug: string;
  installSpec?: ManagedCliInstallSpec;
  onProgress?: (message: string) => void;
}): Promise<void> {
  if (options.manifest.skillMode === 'mono') {
    await installMonoDwsSkillFromReleaseZip(
      options.manifest,
      options.skillSlug,
      options.installSpec,
      options.onProgress,
    );
    return;
  }

  if (!(await dwsSupportsSkillSetup())) {
    throw new Error('dws skillMode=multi requires dws skill setup, which is not supported by current binary');
  }

  options.onProgress?.('正在安装 skill…');
  const skillResult = await runDws(['skill', 'setup', '--mode', 'multi', '-y'], 120_000);
  if (!skillResult.ok) {
    throw new Error(skillResult.error || 'dws skill setup failed');
  }
}

async function installDwsSkillToConnectorCache(
  bundled: DwsBundledManifest,
  skillSlug: string,
  installSpec?: ManagedCliInstallSpec,
  onProgress?: (message: string) => void,
): Promise<void> {
  await installDwsSkillPackageToConnectorCache({
    manifest: bundled,
    skillSlug,
    installSpec,
    onProgress,
  });
  try {
    await installDwsSkillToClaudeCodeDir();
  } catch (error) {
    logger.warn('dws skill setup for Claude Code skipped:', error instanceof Error ? error.message : String(error));
  }
}

async function dwsSupportsSkillSetup(): Promise<boolean> {
  const help = await runDws(['skill', '--help'], 5_000);
  if (!help.ok) return false;
  const text = typeof help.data === 'string'
    ? help.data
    : (help.error ?? '');
  return /\bsetup\b/.test(text);
}


async function installDwsSkillToClaudeCodeDir(): Promise<void> {
  if (!(await dwsSupportsSkillSetup())) {
    // Older binaries lack `dws skill setup`; skip silently.
    return;
  }
  const result = await runDws(['skill', 'setup', '--mode', 'mono', '--target', 'claude', '-y'], 120_000);
  if (!result.ok) {
    logger.warn(`dws skill setup for Claude Code failed (non-fatal): ${result.error ?? ''}`);
    return;
  }
}

async function installBinaryFromManifest(
  bundled: DwsBundledManifest,
  options: DwsInstallOptions,
): Promise<{ success: boolean; path?: string; version?: string; error?: string }> {
  const platformKey = getPlatformKey();
  const platformSpec = bundled.platforms[platformKey];
  const assetName = inferAssetName(platformSpec);
  if (!platformSpec || !assetName) {
    return { success: false, error: `No dws release for platform ${platformKey}` };
  }

  const target = getInstallTarget(options.binary);
  const archiveType = platformSpec.archive
    ?? (assetName.endsWith('.zip') ? 'zip' : 'tar.gz');
  const skillSlug = options.skillSlug?.trim() || normalizeCliBinaryName(options.binary);
  const installSpec = options.installSpec ?? parseManagedCliInstallSpec({});

  const tmpDir = await mkdtemp(join(tmpdir(), 'stoclaw-cli-'));
  const archivePath = join(tmpDir, assetName);

  try {
    options.onProgress?.('正在下载 CLI…');
    await downloadDwsReleaseAsset(
      bundled,
      assetName,
      platformSpec,
      archivePath,
      platformSpec,
      installSpec.sourcePriority,
    );
    options.onProgress?.('正在安装 CLI…');
    const extractDir = join(tmpDir, 'extract');
    mkdirSync(extractDir, { recursive: true });
    await extractArchive(archivePath, extractDir, archiveType);

    const extractedBinary = findBinaryInDir(extractDir, options.binary);
    if (!extractedBinary) {
      throw new Error(`${normalizeCliBinaryName(options.binary)} binary not found in downloaded archive`);
    }

    mkdirSync(dirname(target), { recursive: true });
    if (process.platform === 'win32' && existsSync(target)) {
      const backupPath = `${target}.old-${Date.now()}`;
      renameSync(target, backupPath);
      try {
        await unlink(backupPath);
      } catch {
        // ignore
      }
    }

    renameSync(extractedBinary, target);
    if (process.platform !== 'win32') {
      chmodSync(target, 0o755);
    }
    clearMacQuarantine(target);

    await installDwsSkillToConnectorCache(bundled, skillSlug, installSpec, options.onProgress);

    writeLocalManifest({
      dwsVersion: bundled.dwsVersion,
      skillMode: bundled.skillMode,
      skillsRevision: bundled.skillsRevision,
      binaryPath: target,
      installedAt: new Date().toISOString(),
      bundledByStoClawVersion: app.getVersion(),
    }, options.binary);

    ensureDwsBinInPath();
    logger.info(`cli installed: ${target} -> v${bundled.dwsVersion}`);
    options.notify?.(target);
    invalidateDwsStatusCache();
    return { success: true, path: target, version: normalizeDwsVersion(bundled.dwsVersion) };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('dws install failed:', msg);
    return { success: false, error: msg };
  } finally {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

export async function dwsVersion(): Promise<DwsCliResult> {
  return runDws(['version', '--format', 'json']);
}

export async function dwsAuthStatus(): Promise<DwsCliResult> {
  const status = await runDws(['auth', 'status', '--format', 'json']);
  if (status.ok) return status;
  return runDws(['auth', 'whoami', '--format', 'json']);
}

export async function dwsAuthLogin(parentWindow?: BrowserWindow | null): Promise<DwsCliResult> {
  if (parentWindow && !parentWindow.isDestroyed()) {
    try {
      await getDwsLoginManager().startLogin(parentWindow);
      invalidateDwsStatusCache();
      return { ok: true, exitCode: 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('DWS_LOGIN_CANCELLED') || message.includes('cancel')) {
        return { ok: false, error: message, exitCode: 1 };
      }
      return { ok: false, error: message, exitCode: 1 };
    }
  }

  const result = await runDws(['auth', 'login'], 300_000);
  if (result.ok) invalidateDwsStatusCache();
  return result;
}

export async function dwsCheckInstalled(): Promise<{
  installed: boolean;
  version?: string;
  path?: string;
  skillMode?: string;
  localManifest?: DwsLocalManifest | null;
}> {
  const target = getInstallTarget();
  if (!existsSync(target)) {
    return { installed: false, localManifest: readLocalManifest() };
  }

  const result = await dwsVersion();
  if (!result.ok) {
    return { installed: false, path: target, localManifest: readLocalManifest() };
  }

  let versionStr: string | undefined;
  if (typeof result.data === 'object' && result.data !== null) {
    const data = result.data as Record<string, unknown>;
    versionStr = typeof data.version === 'string' ? data.version : undefined;
  } else if (typeof result.data === 'string') {
    versionStr = result.data;
  }

  const local = readLocalManifest();
  const rawVersion = versionStr ?? local?.dwsVersion;
  return {
    installed: true,
    version: rawVersion ? normalizeDwsVersion(rawVersion) : undefined,
    path: target,
    skillMode: local?.skillMode,
    localManifest: local,
  };
}

export async function installOrUpdateDwsCli(
  options?: DwsInstallOptions | ((path: string) => void),
): Promise<{ success: boolean; path?: string; version?: string; updated?: boolean; error?: string }> {
  const normalized = normalizeDwsInstallOptions(options);
  const enabled = getSetting('dingTalkDwsEnabled');
  if (enabled === false) {
    return { success: true, updated: false };
  }

  const installSpec = normalized.installSpec ?? parseManagedCliInstallSpec({});
  const skillSlug = normalized.skillSlug?.trim() || normalizeCliBinaryName(normalized.binary);
  const bundled = await resolveDwsManifest(normalized);
  if (!bundled) {
    return { success: false, error: 'install manifest missing' };
  }

  const target = getInstallTarget(normalized.binary);
  const local = readLocalManifest(normalized.binary);
  const binaryExists = existsSync(target);
  const skillInstalled = existsSync(join(getDwsConnectorSkillDir(skillSlug), 'SKILL.md'));

  if (
    binaryExists
    && local
    && skillInstalled
    && compareSemver(local.dwsVersion, bundled.dwsVersion) >= 0
    && local.skillsRevision === bundled.skillsRevision
  ) {
    ensureDwsBinInPath();
    invalidateDwsStatusCache();
    return { success: true, path: target, version: normalizeDwsVersion(local.dwsVersion), updated: false };
  }

  if (
    binaryExists
    && local
    && compareSemver(local.dwsVersion, bundled.dwsVersion) >= 0
    && local.skillsRevision === bundled.skillsRevision
    && !skillInstalled
  ) {
    try {
      await installDwsSkillToConnectorCache(bundled, skillSlug, installSpec, normalized.onProgress);
      writeLocalManifest({
        ...local,
        skillMode: bundled.skillMode,
        skillsRevision: bundled.skillsRevision,
        installedAt: new Date().toISOString(),
        bundledByStoClawVersion: app.getVersion(),
      }, normalized.binary);
      ensureDwsBinInPath();
      invalidateDwsStatusCache();
      return {
        success: true,
        path: target,
        version: normalizeDwsVersion(local.dwsVersion),
        updated: true,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('cli skill repair failed:', msg);
      return { success: false, error: msg };
    }
  }

  return installBinaryFromManifest(bundled, { ...normalized, installSpec, skillSlug });
}

export async function autoInstallDwsCliIfNeeded(
  options?: DwsInstallOptions | ((path: string) => void),
): Promise<{ success: boolean; path?: string; updated?: boolean; error?: string }> {
  const result = await installOrUpdateDwsCli(options);
  return {
    success: result.success,
    path: result.path,
    updated: result.updated,
    error: result.error,
  };
}

// ── PATH management (mirrors sai-cli) ───────────────────────────────────────

function ensureDwsBinInPath(): void {
  const platform = process.platform;
  const pathSep = platform === 'win32' ? ';' : ':';
  const currentPath = process.env.PATH || '';

  const pathEntries = currentPath.split(pathSep);
  if (!pathEntries.includes(DWS_BIN_DIR)) {
    process.env.PATH = `${DWS_BIN_DIR}${pathSep}${currentPath}`;
    logger.info(`Added ${DWS_BIN_DIR} to current process PATH`);
  }

  if (platform === 'win32') {
    ensureDwsBinInWindowsPath();
  } else {
    ensureDwsBinInUnixPath();
  }
}

function ensureDwsBinInWindowsPath(): void {
  try {
    const query = spawnSync('reg', [
      'query', 'HKEY_CURRENT_USER\\Environment', '/v', 'PATH',
    ], { encoding: 'utf-8', windowsHide: true });

    let userPath = '';
    if (query.status === 0) {
      const match = query.stdout.match(/PATH\s+REG_\w+\s+(.+)/);
      if (match) userPath = match[1].trim();
    }

    if (userPath.includes(DWS_BIN_DIR)) return;

    const newPath = userPath ? `${userPath};${DWS_BIN_DIR}` : DWS_BIN_DIR;
    const add = spawnSync('reg', [
      'add', 'HKEY_CURRENT_USER\\Environment', '/v', 'PATH',
      '/t', 'REG_EXPAND_SZ', '/d', newPath, '/f',
    ], { encoding: 'utf-8', windowsHide: true });

    if (add.status === 0) {
      logger.info(`Added ${DWS_BIN_DIR} to Windows user PATH`);
    }
  } catch (err) {
    logger.warn('Failed to update Windows PATH for dws:', err);
  }
}

function appendDwsPathToRcFile(rcFile: string, exportLine: string): boolean {
  try {
    if (existsSync(rcFile)) {
      const content = readFileSync(rcFile, 'utf-8');
      if (content.includes(DWS_BIN_DIR)) return true;
      appendFileSync(rcFile, `\n# Added by SClaw (dws)\n${exportLine}\n`);
      logger.info(`Added ${DWS_BIN_DIR} to ${rcFile}`);
      return true;
    }

    // macOS 默认 zsh，很多用户没有 ~/.zshrc；创建以便新终端全局可用。
    if (process.platform === 'darwin' && rcFile.endsWith('.zshrc')) {
      writeFileSync(rcFile, `# Added by SClaw (dws)\n${exportLine}\n`, 'utf-8');
      logger.info(`Created ${rcFile} with ${DWS_BIN_DIR}`);
      return true;
    }
  } catch (err) {
    logger.warn(`Failed to update ${rcFile} for dws:`, err);
  }
  return false;
}

function ensureDwsBinInUnixPath(): void {
  const exportLine = `export PATH="${DWS_BIN_DIR}:\$PATH"`;
  const rcFiles = process.platform === 'darwin'
    ? [
      join(homedir(), '.zshrc'),
      join(homedir(), '.zprofile'),
      join(homedir(), '.bash_profile'),
      join(homedir(), '.bashrc'),
      join(homedir(), '.profile'),
    ]
    : [
      join(homedir(), '.zshrc'),
      join(homedir(), '.bashrc'),
      join(homedir(), '.bash_profile'),
      join(homedir(), '.profile'),
    ];

  let persisted = false;
  for (const rcFile of rcFiles) {
    if (appendDwsPathToRcFile(rcFile, exportLine)) {
      persisted = true;
    }
  }

  if (!persisted && process.platform === 'darwin') {
    appendDwsPathToRcFile(join(homedir(), '.zshrc'), exportLine);
  }
}
