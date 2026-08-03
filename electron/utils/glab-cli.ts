/**
 * GitLab CLI (glab) bridge — detect/install, auth login with PAT, status/logout.
 * Binary preferred at ~/.stoclaw/bin/glab; falls back to PATH.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

import { logger } from './logger';
import { proxyAwareFetch } from './proxy-fetch';

export interface GlabCliResult {
  ok: boolean;
  data?: unknown;
  stdout?: string;
  stderr?: string;
  error?: string;
  exitCode: number;
}

const BIN_DIR = join(homedir(), '.stoclaw', 'bin');

function binaryName(): string {
  return process.platform === 'win32' ? 'glab.exe' : 'glab';
}

function installTarget(): string {
  return join(BIN_DIR, binaryName());
}

/** Match GitLab release asset names, e.g. glab_1.110.0_darwin_arm64.tar.gz */
function platformAssetMatchers(): { needle: string; ext: string } {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'amd64' : process.arch;
  if (process.platform === 'darwin') {
    return { needle: `darwin_${arch}`, ext: 'tar.gz' };
  }
  if (process.platform === 'win32') {
    return { needle: `windows_${arch}`, ext: 'zip' };
  }
  return { needle: `linux_${arch}`, ext: 'tar.gz' };
}

function whichOnPath(name: string): string | null {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(cmd, [name], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return null;
  const line = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  return line || null;
}

export function resolveGlabBinary(): string | null {
  const target = installTarget();
  if (existsSync(target)) return target;
  return whichOnPath(binaryName());
}

export async function glabCheckInstalled(): Promise<{ installed: boolean; version?: string; path?: string }> {
  const path = resolveGlabBinary();
  if (!path) return { installed: false };
  const result = await runGlab(['version'], 15_000, path);
  if (!result.ok) return { installed: true, path, version: undefined };
  const text = `${result.stdout || ''}`.trim();
  const match = text.match(/glab\s+version\s+([^\s]+)/i) || text.match(/(\d+\.\d+\.\d+)/);
  return { installed: true, path, version: match?.[1] };
}

export function runGlab(
  args: string[],
  timeoutMs = 60_000,
  binaryOverride?: string,
): Promise<GlabCliResult> {
  const binary = binaryOverride || resolveGlabBinary();
  if (!binary) {
    return Promise.resolve({
      ok: false,
      error: 'glab 未安装',
      exitCode: -1,
    });
  }

  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      env: { ...process.env },
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
    child.on('error', (error) => {
      resolve({ ok: false, error: error.message, exitCode: -1, stdout, stderr });
    });
    child.on('close', (code) => {
      const exitCode = code ?? -1;
      resolve({
        ok: exitCode === 0,
        exitCode,
        stdout,
        stderr,
        data: stdout.trim() || undefined,
        error: exitCode === 0 ? undefined : (stderr.trim() || stdout.trim() || `glab exited ${exitCode}`),
      });
    });
  });
}

function hostnameFromServerUrl(serverUrl: string): string {
  try {
    const u = new URL(serverUrl.includes('://') ? serverUrl : `https://${serverUrl}`);
    return u.hostname;
  } catch {
    return serverUrl.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim();
  }
}

export async function glabAuthLogin(opts: {
  serverUrl: string;
  token: string;
}): Promise<GlabCliResult> {
  const hostname = hostnameFromServerUrl(opts.serverUrl);
  if (!hostname) {
    return { ok: false, exitCode: -1, error: '无效的 GitLab 服务器地址' };
  }
  // Non-interactive PAT login; HTTPS git protocol so git pull can reuse the token.
  const login = await runGlab(
    [
      'auth',
      'login',
      '--hostname',
      hostname,
      '--token',
      opts.token,
      '--api-protocol',
      'https',
      '--git-protocol',
      'https',
    ],
    60_000,
  );
  if (!login.ok) return login;

  // Make this instance the default so Agent/user can run `glab` without --hostname.
  const hostSet = await glabSetDefaultHost(hostname);
  if (!hostSet.ok) {
    logger.warn('[glab] set default host failed:', hostSet.error || hostSet.stderr);
  }
  return login;
}

/** Global default host (glab config `host`). Empty hostname resets toward gitlab.com. */
export async function glabSetDefaultHost(hostname: string): Promise<GlabCliResult> {
  const host = hostname.trim() || 'gitlab.com';
  return runGlab(['config', 'set', 'host', host, '--global'], 15_000);
}

export async function glabAuthStatus(hostname?: string): Promise<GlabCliResult> {
  const args = ['auth', 'status'];
  if (hostname) args.push('--hostname', hostname);
  return runGlab(args, 20_000);
}

/** Hard auth check: call GitLab `/user` via glab. Prefer this over parsing auth status text. */
export async function glabApiUser(hostname?: string): Promise<GlabCliResult> {
  const args = ['api', 'user'];
  if (hostname) {
    args.push('--hostname', hostname);
  }
  return runGlab(args, 30_000);
}

export async function glabVerifyAuthenticated(hostname?: string): Promise<boolean> {
  const api = await glabApiUser(hostname);
  if (!api.ok) return false;
  const text = `${api.stdout || ''}`.trim();
  if (!text) return false;
  try {
    const json = JSON.parse(text) as { id?: unknown; username?: unknown };
    return typeof json.id === 'number' || typeof json.username === 'string';
  } catch {
    // Some glab versions may wrap output; accept non-empty success.
    return text.length > 2 && !/error|unauthorized|401|forbidden/i.test(text);
  }
}

export async function glabAuthLogout(hostname?: string): Promise<GlabCliResult> {
  const args = ['auth', 'logout'];
  if (hostname) args.push('--hostname', hostname);
  const result = await runGlab(args, 20_000);
  // Avoid leaving Agent pointed at a disconnected private host.
  if (hostname) {
    const current = await runGlab(['config', 'get', 'host'], 10_000);
    const value = `${current.stdout || ''}`.trim().toLowerCase();
    if (value === hostname.toLowerCase() || value.includes(hostname.toLowerCase())) {
      await glabSetDefaultHost('gitlab.com');
    }
  }
  return result;
}

export function isGlabAuthenticated(status: GlabCliResult, hostname?: string): boolean {
  if (!status.ok && !status.stdout && !status.stderr) return false;
  const text = `${status.stdout || ''}\n${status.stderr || ''}`;
  const lower = text.toLowerCase();
  // Token present but API failing is NOT authenticated.
  if (/api call failed|401|unauthorized|forbidden|could not authenticate/i.test(text)) {
    return false;
  }
  if (/not logged in|no token|no accounts/i.test(lower) && !/logged in to/i.test(text)) {
    return false;
  }
  if (hostname) {
    const host = hostname.toLowerCase();
    if (!lower.includes(host) && !/logged in to/i.test(text)) {
      return false;
    }
  }
  return (
    status.ok ||
    /logged in to\s+\S+/i.test(text) ||
    (/token found/i.test(text) && /✓/.test(text) && !/✖|✗|x [a-z0-9.-]+:/i.test(text))
  );
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const response = await proxyAwareFetch(url, {
    timeoutMs: 120_000,
    headers: { 'User-Agent': 'StoClaw-Connector' },
  });
  if (!response.ok || !response.body) {
    throw new Error(`下载失败 HTTP ${response.status}`);
  }
  // @ts-expect-error Node fetch body is a web stream
  const nodeStream = Readable.fromWeb(response.body);
  await pipeline(nodeStream, createWriteStream(dest));
}

async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  if (archivePath.endsWith('.zip')) {
    if (process.platform === 'win32') {
      const r = spawnSync(
        'powershell',
        ['-NoProfile', '-Command', `Expand-Archive -Path "${archivePath}" -DestinationPath "${destDir}" -Force`],
        { encoding: 'utf8', windowsHide: true },
      );
      if (r.status !== 0) throw new Error(r.stderr || '解压 zip 失败');
      return;
    }
    const r = spawnSync('unzip', ['-o', archivePath, '-d', destDir], {
      encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error(r.stderr || '解压 zip 失败');
    return;
  }
  const r = spawnSync('tar', ['-xzf', archivePath, '-C', destDir], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || '解压 tar.gz 失败');
}

async function findGlabInDir(dir: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findGlabInDir(full);
      if (nested) return nested;
      continue;
    }
    if (entry.name === binaryName() || entry.name === 'glab') return full;
  }
  return null;
}

async function resolveLatestAssetUrl(options?: {
  releaseApiUrl?: string;
  assetNameHint?: string;
}): Promise<{ url: string; version: string }> {
  const hint = platformAssetMatchers();
  const needle = options?.assetNameHint?.trim() || hint.needle;
  // glab 源码与 release 已迁至 gitlab.com；GitHub mirror 的 /releases/latest 会 404
  const api =
    options?.releaseApiUrl?.trim()
    || 'https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/releases?per_page=1';
  const response = await proxyAwareFetch(api, {
    timeoutMs: 30_000,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'StoClaw-Connector',
    },
  });
  if (!response.ok) {
    throw new Error(`获取 glab 版本失败 HTTP ${response.status}`);
  }
  const json = (await response.json()) as Array<{
    tag_name?: string;
    assets?: {
      links?: Array<{
        name?: string;
        url?: string;
        direct_asset_url?: string;
      }>;
    };
  }>;
  const release = Array.isArray(json) ? json[0] : null;
  if (!release) {
    throw new Error('未获取到 glab release 信息');
  }
  const version = (release.tag_name || '').replace(/^v/, '');
  const links = release.assets?.links || [];
  const match = links.find((asset) => {
    const name = asset.name || '';
    const lower = name.toLowerCase();
    return (
      lower.includes(needle.toLowerCase()) &&
      lower.endsWith(`.${hint.ext}`) &&
      !lower.includes('checksum') &&
      !lower.includes('installer') &&
      !lower.includes('source')
    );
  });
  if (!match) {
    throw new Error(`未找到适配 ${needle} 的 glab 安装包`);
  }
  const url = match.direct_asset_url || match.url;
  if (!url) {
    throw new Error('glab 安装包下载地址为空');
  }
  return { url, version: version || 'unknown' };
}

export interface GlabInstallOptions {
  releaseApiUrl?: string;
  assetNameHint?: string;
}

export async function installOrUpdateGlabCli(options?: GlabInstallOptions): Promise<{
  success: boolean;
  version?: string;
  path?: string;
  error?: string;
}> {
  const { installViaReleaseAsset } = await import('../connectors/installers/release-asset-installer');
  return installViaReleaseAsset({
    binary: 'glab',
    releaseApiUrl:
      options?.releaseApiUrl?.trim()
      || 'https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/releases?per_page=1',
    assetNameHint: options?.assetNameHint,
  });
}

export { hostnameFromServerUrl };
