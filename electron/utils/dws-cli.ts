/**
 * DingTalk Workspace CLI (dws) bridge — download, install, PATH, spawn.
 *
 * Binary + skill are upgraded atomically from bundled manifest (GitHub Releases).
 * Skill (mono) is installed to ~/.stoclaw/openclaw/skills/dws via release dws-skills.zip.
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
import { logger } from './logger';
import { proxyAwareFetch } from './proxy-fetch';
import { getSetting } from './store';
import { getDwsLoginManager } from './dws-login';
import { getOpenClawSkillsDir } from './paths';
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

function getBinaryName(): string {
  return process.platform === 'win32' ? 'dws.exe' : 'dws';
}

function getInstallTarget(): string {
  return join(DWS_BIN_DIR, getBinaryName());
}

function getPlatformKey(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `${process.platform}-${arch}`;
}

function resolveBundledManifestPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources', 'dws', 'manifest.json');
  }
  return join(process.cwd(), 'resources', 'dws', 'manifest.json');
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
  const target = getInstallTarget();
  if (existsSync(target)) return target;
  const name = getBinaryName();
  return name;
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

function readBundledManifest(): DwsBundledManifest | null {
  const path = resolveBundledManifestPath();
  if (!existsSync(path)) {
    logger.warn('Bundled dws manifest not found:', path);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as DwsBundledManifest;
  } catch (error) {
    logger.warn('Failed to read bundled dws manifest:', error);
    return null;
  }
}

function readLocalManifest(): DwsLocalManifest | null {
  if (!existsSync(LOCAL_MANIFEST_PATH)) return null;
  try {
    return JSON.parse(readFileSync(LOCAL_MANIFEST_PATH, 'utf-8')) as DwsLocalManifest;
  } catch {
    return null;
  }
}

function writeLocalManifest(manifest: DwsLocalManifest): void {
  mkdirSync(DWS_STATE_DIR, { recursive: true });
  writeFileSync(LOCAL_MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8');
}

async function downloadDwsReleaseAsset(
  bundled: DwsBundledManifest,
  assetName: string,
  platformSpec: DwsPlatformAssetSpec | null,
  targetPath: string,
  checksumSpec?: DwsAssetChecksumSpec | null,
): Promise<void> {
  const resolved = await resolveAssetDownloadUrlWithFallback({
    manifest: bundled,
    version: bundled.dwsVersion,
    assetName,
    platformSpec,
    fetchFn: proxyAwareFetch,
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

async function downloadFile(url: string, targetPath: string, expectedSha256?: string | null): Promise<void> {
  const response = await proxyAwareFetch(url, { timeoutMs: 180_000 });
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

function findBinaryInDir(dir: string): string | null {
  const expected = getBinaryName();
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      const nested = findBinaryInDir(full);
      if (nested) return nested;
      continue;
    }
    if (entry === expected || entry === 'dws' || entry === 'dws.exe') {
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

function getDwsOpenClawSkillDir(): string {
  return join(getOpenClawSkillsDir(), 'dws');
}

async function installMonoDwsSkillFromReleaseZip(bundled: DwsBundledManifest): Promise<void> {
  const skillsAssetName = bundled.skillsZip?.assetName || SKILLS_ZIP_ASSET_NAME;
  const skillDir = getDwsOpenClawSkillDir();
  const tmpDir = await mkdtemp(join(tmpdir(), 'stoclaw-dws-skill-'));
  const zipPath = join(tmpDir, 'dws-skills.zip');
  const extractDir = join(tmpDir, 'extract');

  try {
    await downloadDwsReleaseAsset(
      bundled,
      skillsAssetName,
      bundled.skillsZip?.url ? { url: bundled.skillsZip.url, assetName: skillsAssetName } : null,
      zipPath,
      bundled.skillsZip,
    );
    mkdirSync(extractDir, { recursive: true });
    await extractArchive(zipPath, extractDir, 'zip');

    mkdirSync(getOpenClawSkillsDir(), { recursive: true });
    rmSync(skillDir, { recursive: true, force: true });
    cpSync(extractDir, skillDir, { recursive: true });

    if (!existsSync(join(skillDir, 'SKILL.md'))) {
      throw new Error('dws skill install failed: SKILL.md missing after extract');
    }

    logger.info(`dws skill installed: ${skillDir}`);
  } finally {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
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

async function installDwsSkillToOpenClawSkillsDir(bundled: DwsBundledManifest): Promise<void> {
  if (bundled.skillMode === 'mono') {
    await installMonoDwsSkillFromReleaseZip(bundled);
    return;
  }

  if (!(await dwsSupportsSkillSetup())) {
    throw new Error('dws skillMode=multi requires dws skill setup, which is not supported by current binary');
  }

  const skillResult = await runDws(['skill', 'setup', '--mode', 'multi', '-y'], 120_000);
  if (!skillResult.ok) {
    throw new Error(skillResult.error || 'dws skill setup failed');
  }
  logger.warn('dws skillMode=multi installed via dws skill setup; verify skills under ~/.stoclaw/openclaw/skills/');
}

async function installBinaryFromManifest(
  bundled: DwsBundledManifest,
  notify?: (path: string) => void,
): Promise<{ success: boolean; path?: string; version?: string; error?: string }> {
  const platformKey = getPlatformKey();
  const platformSpec = bundled.platforms[platformKey];
  const assetName = inferAssetName(platformSpec);
  if (!platformSpec || !assetName) {
    return { success: false, error: `No dws release for platform ${platformKey}` };
  }

  const target = getInstallTarget();
  const archiveType = platformSpec.archive
    ?? (assetName.endsWith('.zip') ? 'zip' : 'tar.gz');

  const tmpDir = await mkdtemp(join(tmpdir(), 'stoclaw-dws-'));
  const archivePath = join(tmpDir, assetName);

  try {
    await downloadDwsReleaseAsset(bundled, assetName, platformSpec, archivePath, platformSpec);
    const extractDir = join(tmpDir, 'extract');
    mkdirSync(extractDir, { recursive: true });
    await extractArchive(archivePath, extractDir, archiveType);

    const extractedBinary = findBinaryInDir(extractDir);
    if (!extractedBinary) {
      throw new Error('dws binary not found in downloaded archive');
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

    await installDwsSkillToOpenClawSkillsDir(bundled);

    writeLocalManifest({
      dwsVersion: bundled.dwsVersion,
      skillMode: bundled.skillMode,
      skillsRevision: bundled.skillsRevision,
      binaryPath: target,
      installedAt: new Date().toISOString(),
      bundledByStoClawVersion: app.getVersion(),
    });

    ensureDwsBinInPath();
    logger.info(`dws installed: ${target} -> v${bundled.dwsVersion}`);
    notify?.(target);
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
      return { ok: true, exitCode: 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('DWS_LOGIN_CANCELLED') || message.includes('cancel')) {
        return { ok: false, error: message, exitCode: 1 };
      }
      return { ok: false, error: message, exitCode: 1 };
    }
  }

  return runDws(['auth', 'login'], 300_000);
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
  notify?: (path: string) => void,
): Promise<{ success: boolean; path?: string; version?: string; updated?: boolean; error?: string }> {
  const enabled = getSetting('dingTalkDwsEnabled');
  if (enabled === false) {
    return { success: true, updated: false };
  }

  const bundled = readBundledManifest();
  if (!bundled) {
    return { success: false, error: 'Bundled dws manifest missing' };
  }

  const target = getInstallTarget();
  const local = readLocalManifest();
  const binaryExists = existsSync(target);
  const skillInstalled = existsSync(join(getDwsOpenClawSkillDir(), 'SKILL.md'));

  if (
    binaryExists
    && local
    && skillInstalled
    && compareSemver(local.dwsVersion, bundled.dwsVersion) >= 0
    && local.skillsRevision === bundled.skillsRevision
  ) {
    ensureDwsBinInPath();
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
      await installDwsSkillToOpenClawSkillsDir(bundled);
      writeLocalManifest({
        ...local,
        skillMode: bundled.skillMode,
        skillsRevision: bundled.skillsRevision,
        installedAt: new Date().toISOString(),
        bundledByStoClawVersion: app.getVersion(),
      });
      ensureDwsBinInPath();
      logger.info(`dws skill repaired under ${getDwsOpenClawSkillDir()}`);
      return {
        success: true,
        path: target,
        version: normalizeDwsVersion(local.dwsVersion),
        updated: true,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('dws skill repair failed:', msg);
      return { success: false, error: msg };
    }
  }

  return installBinaryFromManifest(bundled, notify);
}

export async function autoInstallDwsCliIfNeeded(
  notify?: (path: string) => void,
): Promise<{ success: boolean; path?: string; updated?: boolean; error?: string }> {
  const result = await installOrUpdateDwsCli(notify);
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
      appendFileSync(rcFile, `\n# Added by STO Claw (dws)\n${exportLine}\n`);
      logger.info(`Added ${DWS_BIN_DIR} to ${rcFile}`);
      return true;
    }

    // macOS 默认 zsh，很多用户没有 ~/.zshrc；创建以便新终端全局可用。
    if (process.platform === 'darwin' && rcFile.endsWith('.zshrc')) {
      writeFileSync(rcFile, `# Added by STO Claw (dws)\n${exportLine}\n`, 'utf-8');
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
