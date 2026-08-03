/**
 * QPath CLI bridge — install (official script), PATH, skill (versioned), status/whoami/logout.
 * Binary lives at ~/.sto/qpath-cli/bin (official layout; do not move under ~/.stoclaw/bin).
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  createWriteStream,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import {
  extractQpathSkillRevisionFromFilename,
  isQpathAuthExpiredMessage,
  parseQpathStatusLoggedIn,
  shouldUpdateQpathSkill,
} from '../connectors/adapters/qpath-auth-status';
import { logger } from './logger';
import { getClaudeSkillsDir, getOpenClawSkillsDir } from './paths';
import { proxyAwareFetch } from './proxy-fetch';

export interface QpathCliResult {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
  exitCode: number;
}

export const QPATH_INSTALL_SCRIPT_UNIX = 'https://operation-pmai.sto.cn/api/qpath-cli/prod/install';
export const QPATH_INSTALL_SCRIPT_WINDOWS =
  'https://operation-pmai.sto.cn/api/qpath-cli/prod/install.cmd';
export const QPATH_SKILL_ARCHIVE_URL =
  'https://gitlab.sto.cn/pm-ai-public/qpath-cli-skill/-/archive/main/archive.tar.gz';
export const QPATH_SKILL_NAME = 'qpath-cli-commands';

export interface QpathInstallOptions {
  /** Override Unix install script URL (from server installSpec.unix). */
  unix?: string;
  /** Override Windows install script URL (from server installSpec.windows). */
  windows?: string;
}

const SKILL_MANIFEST_DIR = join(homedir(), '.stoclaw', 'qpath');
const SKILL_MANIFEST_PATH = join(SKILL_MANIFEST_DIR, 'skill-manifest.json');

interface QpathSkillManifest {
  revision: string;
  installedAt: string;
}

export function getQpathBinDir(): string {
  return join(homedir(), '.sto', 'qpath-cli', 'bin');
}

export function getQpathBinaryName(): string {
  return process.platform === 'win32' ? 'qpath.exe' : 'qpath';
}

export function getQpathBinaryPath(): string {
  return join(getQpathBinDir(), getQpathBinaryName());
}

function whichOnPath(name: string): string | null {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(cmd, [name], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return null;
  const line = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  return line || null;
}

export function resolveQpathBinary(): string | null {
  const target = getQpathBinaryPath();
  if (existsSync(target)) return target;
  return whichOnPath(getQpathBinaryName());
}

export function ensureQpathBinInPath(): void {
  const binDir = getQpathBinDir();
  const pathSep = process.platform === 'win32' ? ';' : ':';
  const current = process.env.PATH || '';
  const entries = current.split(pathSep);
  if (!entries.includes(binDir)) {
    process.env.PATH = `${binDir}${pathSep}${current}`;
    logger.info(`[qpath] Added ${binDir} to process PATH`);
  }
}

export function runQpath(
  args: string[],
  timeoutMs = 60_000,
  binaryPath?: string,
): Promise<QpathCliResult> {
  const binary = binaryPath || resolveQpathBinary();
  if (!binary) {
    return Promise.resolve({
      ok: false,
      error: 'qpath is not installed',
      exitCode: 127,
    });
  }

  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      env: process.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({
        ok: false,
        stdout,
        stderr,
        error: `qpath ${args.join(' ')} timed out`,
        exitCode: 124,
      });
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        stdout,
        stderr,
        error: error.message,
        exitCode: 1,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const exitCode = code ?? 1;
      resolve({
        ok: exitCode === 0,
        stdout,
        stderr,
        error: exitCode === 0 ? undefined : (stderr || stdout || `exit ${exitCode}`).trim(),
        exitCode,
      });
    });
  });
}

export async function qpathCheckInstalled(): Promise<{
  installed: boolean;
  version?: string;
  path?: string;
}> {
  const path = resolveQpathBinary();
  if (!path) return { installed: false };
  ensureQpathBinInPath();
  const result = await runQpath(['version'], 15_000, path);
  const text = `${result.stdout || ''}${result.stderr || ''}`.trim();
  const version = text.match(/(\d+\.\d+\.\d+)/)?.[1] || (result.ok ? text.split(/\s+/)[0] : undefined);
  return { installed: true, path, version };
}

export async function qpathIsAuthenticated(): Promise<boolean> {
  const installed = await qpathCheckInstalled();
  if (!installed.installed) return false;
  const status = await runQpath(['status'], 20_000);
  if (status.ok && parseQpathStatusLoggedIn(`${status.stdout || ''}\n${status.stderr || ''}`)) {
    return true;
  }
  const whoami = await runQpath(['whoami'], 20_000);
  if (whoami.ok) return true;
  const combined = `${whoami.stderr || ''}\n${whoami.stdout || ''}\n${status.stderr || ''}`;
  if (isQpathAuthExpiredMessage(combined)) return false;
  return false;
}

export async function qpathLogout(): Promise<QpathCliResult> {
  return runQpath(['logout'], 30_000);
}

function readSkillManifest(): QpathSkillManifest | null {
  try {
    if (!existsSync(SKILL_MANIFEST_PATH)) return null;
    const raw = JSON.parse(readFileSync(SKILL_MANIFEST_PATH, 'utf8')) as QpathSkillManifest;
    if (!raw?.revision) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeSkillManifest(revision: string): void {
  mkdirSync(SKILL_MANIFEST_DIR, { recursive: true });
  const payload: QpathSkillManifest = {
    revision,
    installedAt: new Date().toISOString(),
  };
  writeFileSync(SKILL_MANIFEST_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function skillInstalledOnDisk(): boolean {
  return existsSync(join(getOpenClawSkillsDir(), QPATH_SKILL_NAME, 'SKILL.md'));
}

/**
 * 用 Node http(s) 下载二进制，禁止走 Electron net.fetch / Chromium fetch。
 * gitlab.sto.cn 对带 `Sec-Fetch-Mode: cors` 的请求会直接 406。
 */
async function downloadBinaryViaNodeHttp(
  url: string,
  dest: string,
  redirects = 0,
): Promise<IncomingHttpHeaders> {
  if (redirects > 10) {
    throw new Error(`下载失败：重定向过多 (${url})`);
  }

  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          Accept: '*/*',
          'User-Agent': 'StoClaw-Connector',
        },
        timeout: 120_000,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.resume();
          const next = new URL(location, url).toString();
          downloadBinaryViaNodeHttp(next, dest, redirects + 1).then(resolve, reject);
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`下载失败 HTTP ${status}: ${url}`));
          return;
        }
        pipeline(res, createWriteStream(dest))
          .then(() => resolve(res.headers))
          .catch(reject);
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error('下载超时（120秒未响应）'));
    });
    req.on('error', reject);
  });
}

async function downloadToFile(url: string, dest: string): Promise<{ revision: string | null }> {
  const headers = await downloadBinaryViaNodeHttp(url, dest);
  const disposition = String(headers['content-disposition'] || '');
  const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
  const etag = String(headers.etag || '').replace(/"/g, '').trim();
  const revision =
    extractQpathSkillRevisionFromFilename(filenameMatch?.[1] || '')
    || extractQpathSkillRevisionFromFilename(url)
    || (etag || null);
  return { revision };
}

function extractTarGz(archivePath: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  const r = spawnSync('tar', ['-xzf', archivePath, '-C', destDir], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout || '解压 skill 失败');
  }
}

function findSkillRoot(extractDir: string): string {
  const entries = readdirSync(extractDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(extractDir, entry.name);
    if (existsSync(join(candidate, 'SKILL.md'))) return candidate;
  }
  if (existsSync(join(extractDir, 'SKILL.md'))) return extractDir;
  throw new Error('skill 包中未找到 SKILL.md');
}

function copySkillTo(targetDir: string, sourceRoot: string): void {
  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true });
  }
  mkdirSync(join(targetDir, '..'), { recursive: true });
  cpSync(sourceRoot, targetDir, { recursive: true });
}

export async function ensureQpathSkill(): Promise<{
  updated: boolean;
  revision: string | null;
  skipped: boolean;
}> {
  const local = readSkillManifest();
  const tmpRoot = await mkdtemp(join(tmpdir(), 'stoclaw-qpath-skill-'));
  const archivePath = join(tmpRoot, 'skill.tgz');
  try {
    const { revision: remoteRevision } = await downloadToFile(QPATH_SKILL_ARCHIVE_URL, archivePath);
    const onDisk = skillInstalledOnDisk();
    if (onDisk && !shouldUpdateQpathSkill(local?.revision, remoteRevision)) {
      return { updated: false, revision: local?.revision ?? remoteRevision, skipped: true };
    }
    if (!remoteRevision && onDisk && local?.revision) {
      // Cannot determine remote version — keep existing skill.
      return { updated: false, revision: local.revision, skipped: true };
    }
    const remote = remoteRevision || `unknown-${Date.now()}`;

    const extractDir = join(tmpRoot, 'extract');
    extractTarGz(archivePath, extractDir);
    const sourceRoot = findSkillRoot(extractDir);
    copySkillTo(join(getOpenClawSkillsDir(), QPATH_SKILL_NAME), sourceRoot);
    try {
      copySkillTo(join(getClaudeSkillsDir(), QPATH_SKILL_NAME), sourceRoot);
    } catch (error) {
      logger.warn(
        '[qpath] Claude skill install skipped:',
        error instanceof Error ? error.message : String(error),
      );
    }
    writeSkillManifest(remote);
    return { updated: true, revision: remote, skipped: false };
  } finally {
    try {
      await rm(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

async function runUnixInstallScript(scriptUrl = QPATH_INSTALL_SCRIPT_UNIX): Promise<void> {
  const response = await proxyAwareFetch(scriptUrl, {
    redirect: 'follow',
    headers: { Accept: '*/*' },
    timeoutMs: 60_000,
  });
  if (!response.ok) {
    throw new Error(`获取安装脚本失败 HTTP ${response.status}（请确认办公网/VPN）`);
  }
  const script = await response.text();
  const tmpDir = await mkdtemp(join(tmpdir(), 'stoclaw-qpath-install-'));
  const scriptPath = join(tmpDir, 'install.sh');
  try {
    await writeFile(scriptPath, script, { mode: 0o755 });
    chmodSync(scriptPath, 0o755);
    const r = spawnSync('bash', [scriptPath], {
      encoding: 'utf8',
      windowsHide: true,
      env: process.env,
    });
    if (r.status !== 0) {
      throw new Error((r.stderr || r.stdout || `install exit ${r.status}`).trim());
    }
  } finally {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

async function runWindowsInstallScript(scriptUrl = QPATH_INSTALL_SCRIPT_WINDOWS): Promise<void> {
  const response = await proxyAwareFetch(scriptUrl, {
    redirect: 'follow',
    headers: { Accept: '*/*' },
    timeoutMs: 60_000,
  });
  if (!response.ok) {
    throw new Error(`获取 Windows 安装脚本失败 HTTP ${response.status}`);
  }
  const script = await response.text();
  const tmpDir = await mkdtemp(join(tmpdir(), 'stoclaw-qpath-install-'));
  const scriptPath = join(tmpDir, 'install.cmd');
  try {
    await writeFile(scriptPath, script);
    const r = spawnSync('cmd.exe', ['/c', scriptPath], {
      encoding: 'utf8',
      windowsHide: true,
      cwd: tmpDir,
      env: process.env,
    });
    if (r.status !== 0) {
      throw new Error((r.stderr || r.stdout || `install.cmd exit ${r.status}`).trim());
    }
  } finally {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

export async function installOrUpdateQpathCli(options?: QpathInstallOptions): Promise<{
  success: boolean;
  path?: string;
  version?: string;
  updated?: boolean;
  error?: string;
}> {
  const { installViaShellScript } = await import('../connectors/installers/shell-script-installer');
  return installViaShellScript({
    binary: 'qpath',
    unix: options?.unix?.trim() || QPATH_INSTALL_SCRIPT_UNIX,
    windows: options?.windows?.trim() || QPATH_INSTALL_SCRIPT_WINDOWS,
    binDir: '~/.sto/qpath-cli/bin',
  });
}
