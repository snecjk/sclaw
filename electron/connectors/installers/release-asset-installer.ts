/**
 * Generic release_asset installer — fetch release API, pick platform asset, install binary.
 * Supports GitLab releases links API (glab-style) and GitHub release assets array.
 */
import { spawnSync } from 'node:child_process';
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
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { logger } from '../../utils/logger';
import { proxyAwareFetch } from '../../utils/proxy-fetch';

export interface ReleaseAssetInstallOptions {
  binary: string;
  releaseApiUrl: string;
  assetNameHint?: string;
  /** Default ~/.stoclaw/bin */
  binDir?: string;
}

export interface ReleaseAssetInstallResult {
  success: boolean;
  path?: string;
  version?: string;
  error?: string;
}

function expandHome(pathValue: string): string {
  const trimmed = pathValue.trim();
  if (trimmed.startsWith('~/') || trimmed === '~') {
    return join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}

function binaryFileName(binary: string): string {
  const base = binary.trim().replace(/\.exe$/i, '') || 'cli';
  return process.platform === 'win32' ? `${base}.exe` : base;
}

function defaultBinDir(): string {
  return join(homedir(), '.stoclaw', 'bin');
}

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

function resolveExistingBinary(binary: string, binDir: string): string | null {
  const name = binaryFileName(binary);
  const target = join(binDir, name);
  if (existsSync(target)) return target;
  return whichOnPath(name);
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const response = await proxyAwareFetch(url, {
    timeoutMs: 180_000,
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
    const r = spawnSync('unzip', ['-o', archivePath, '-d', destDir], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr || '解压 zip 失败');
    return;
  }
  const r = spawnSync('tar', ['-xzf', archivePath, '-C', destDir], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || '解压 tar.gz 失败');
}

async function findBinaryInDir(dir: string, binary: string): Promise<string | null> {
  const want = binaryFileName(binary);
  const base = binary.trim().replace(/\.exe$/i, '');
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findBinaryInDir(full, binary);
      if (nested) return nested;
      continue;
    }
    if (entry.name === want || entry.name === base) return full;
  }
  return null;
}

function matchAssetName(
  name: string,
  needle: string,
  ext: string,
): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes(needle.toLowerCase())
    && lower.endsWith(`.${ext}`)
    && !lower.includes('checksum')
    && !lower.includes('installer')
    && !lower.includes('source')
  );
}

async function resolveReleaseAsset(options: {
  releaseApiUrl: string;
  assetNameHint?: string;
}): Promise<{ url: string; version: string }> {
  const hint = platformAssetMatchers();
  const needle = options.assetNameHint?.trim() || hint.needle;
  const response = await proxyAwareFetch(options.releaseApiUrl, {
    timeoutMs: 60_000,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'StoClaw-Connector',
    },
  });
  if (!response.ok) {
    throw new Error(`获取 release 失败 HTTP ${response.status}`);
  }
  const json = (await response.json()) as unknown;

  // GitLab: array of releases with assets.links
  if (Array.isArray(json)) {
    const release = json[0] as {
      tag_name?: string;
      name?: string;
      assets?: {
        links?: Array<{ name?: string; url?: string; direct_asset_url?: string }>;
      };
    } | undefined;
    if (!release) throw new Error('未获取到 release 信息');
    const version = (release.tag_name || release.name || '').replace(/^v/, '') || 'unknown';
    const links = release.assets?.links || [];
    const match = links.find((asset) => matchAssetName(asset.name || '', needle, hint.ext));
    if (!match) throw new Error(`未找到适配 ${needle} 的安装包`);
    const url = match.direct_asset_url || match.url;
    if (!url) throw new Error('安装包下载地址为空');
    return { url, version };
  }

  // GitHub: single release object with assets[]
  if (json && typeof json === 'object') {
    const release = json as {
      tag_name?: string;
      name?: string;
      assets?: Array<{ name?: string; browser_download_url?: string }>;
    };
    const version = (release.tag_name || release.name || '').replace(/^v/, '') || 'unknown';
    const assets = release.assets || [];
    const match = assets.find((asset) => matchAssetName(asset.name || '', needle, hint.ext));
    if (!match?.browser_download_url) throw new Error(`未找到适配 ${needle} 的安装包`);
    return { url: match.browser_download_url, version };
  }

  throw new Error('release API 响应格式无效');
}

function probeVersion(binaryPath: string): string | undefined {
  const r = spawnSync(binaryPath, ['version'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  });
  const text = `${r.stdout || ''}\n${r.stderr || ''}`.trim();
  const match =
    text.match(/version\s+([^\s]+)/i)
    || text.match(/(\d+\.\d+\.\d+[^\s]*)/);
  return match?.[1];
}

export async function installViaReleaseAsset(
  options: ReleaseAssetInstallOptions,
): Promise<ReleaseAssetInstallResult> {
  try {
    const binary = options.binary.trim().replace(/\.exe$/i, '');
    if (!binary) return { success: false, error: 'runtime.binary 不能为空' };
    const releaseApiUrl = options.releaseApiUrl?.trim();
    if (!releaseApiUrl) return { success: false, error: '缺少 install.releaseApiUrl' };

    const binDir = expandHome(options.binDir?.trim() || defaultBinDir());
    mkdirSync(binDir, { recursive: true });

    const existing = resolveExistingBinary(binary, binDir);
    if (existing) {
      return { success: true, path: existing, version: probeVersion(existing) };
    }

    const { url, version } = await resolveReleaseAsset({
      releaseApiUrl,
      assetNameHint: options.assetNameHint,
    });
    const tmp = await mkdtemp(join(tmpdir(), 'stoclaw-cli-release-'));
    try {
      const archiveName = basename(new URL(url).pathname) || `cli.${platformAssetMatchers().ext}`;
      const archivePath = join(tmp, archiveName);
      logger.info(`[managed-cli] downloading ${url}`);
      await downloadToFile(url, archivePath);
      await extractArchive(archivePath, tmp);
      const found = await findBinaryInDir(tmp, binary);
      if (!found) throw new Error(`安装包中未找到 ${binary} 可执行文件`);
      const target = join(binDir, binaryFileName(binary));
      try {
        if (existsSync(target)) rmSync(target);
      } catch {
        // ignore
      }
      renameSync(found, target);
      if (process.platform !== 'win32') chmodSync(target, 0o755);
      return { success: true, version, path: target };
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[managed-cli] release_asset install failed:', message);
    return { success: false, error: message };
  }
}
