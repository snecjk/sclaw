/**
 * Install connector detail skill into ~/.stoclaw/connectors/skills/{slug}/ during connect.
 */
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { parseManagedCliInstallSpec } from '../../shared/connectors/parse-install-spec';
import {
  connectorSkillSlug,
  resolveConnectorAgentSkillFromDescriptor,
} from '../../shared/connectors/resolve-agent-skill';
import {
  extractSkillRevisionFromFilename,
  shouldUpdateSkillRevision,
} from '../../shared/connectors/skill-revision';
import type { ConnectorDescriptor } from '../../shared/connectors/types';
import {
  installDwsSkillPackageToConnectorCache,
  type DwsBundledManifest,
} from '../utils/dws-cli';
import { logger } from '../utils/logger';
import { proxyAwareFetch } from '../utils/proxy-fetch';
import { extractTarGz } from '../utils/tar-extract';
import { extractZip } from '../utils/zip-extract';
import { getConnectorSkillsCacheDir } from './connector-skill-sync';

const LEGACY_QPATH_SKILL_MANIFEST = join(homedir(), '.stoclaw', 'qpath', 'skill-manifest.json');
const SKILL_REVISION_FILE = '.stoclaw-skill-revision.json';

export function getConnectorSkillCacheDir(slug: string): string {
  return join(getConnectorSkillsCacheDir(), slug);
}

export function connectorSkillInstalled(slug: string): boolean {
  return existsSync(join(getConnectorSkillCacheDir(slug), 'SKILL.md'));
}

function skillRevisionPath(slug: string): string {
  return join(getConnectorSkillCacheDir(slug), SKILL_REVISION_FILE);
}

function readSkillRevision(slug: string): { revision: string } | null {
  try {
    const path = skillRevisionPath(slug);
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { revision?: string };
      if (raw?.revision) return { revision: raw.revision };
    }
    // Compat: old QPath revision file
    if (slug === 'qpath-cli-commands' && existsSync(LEGACY_QPATH_SKILL_MANIFEST)) {
      const raw = JSON.parse(readFileSync(LEGACY_QPATH_SKILL_MANIFEST, 'utf8')) as {
        revision?: string;
      };
      if (raw?.revision) return { revision: raw.revision };
    }
    return null;
  } catch {
    return null;
  }
}

function writeSkillRevision(slug: string, revision: string): void {
  const dir = getConnectorSkillCacheDir(slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    skillRevisionPath(slug),
    `${JSON.stringify({ revision, installedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );
}

async function downloadViaNodeHttp(url: string, dest: string, redirects = 0): Promise<{ revision: string | null }> {
  if (redirects > 10) throw new Error(`下载失败：重定向过多 (${url})`);
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(
      url,
      { headers: { Accept: '*/*', 'User-Agent': 'StoClaw-Connector' }, timeout: 120_000 },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.resume();
          downloadViaNodeHttp(new URL(location, url).toString(), dest, redirects + 1).then(resolve, reject);
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`下载失败 HTTP ${status}: ${url}`));
          return;
        }
        pipeline(res, createWriteStream(dest))
          .then(() => {
            const disposition = String(res.headers['content-disposition'] || '');
            const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
            const etag = String(res.headers.etag || '').replace(/"/g, '').trim();
            const revision =
              extractSkillRevisionFromFilename(filenameMatch?.[1] || '')
              || extractSkillRevisionFromFilename(url)
              || (etag || null);
            resolve({ revision });
          })
          .catch(reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('下载超时（120秒未响应）')));
    req.on('error', reject);
  });
}

async function downloadPackageToFile(url: string, dest: string): Promise<void> {
  if (/gitlab\.sto\.cn/i.test(url)) {
    await downloadViaNodeHttp(url, dest);
    return;
  }
  const response = await proxyAwareFetch(url, { timeoutMs: 180_000 });
  if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}: ${url}`);
  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(dest),
  );
}

function findSkillRoot(extractDir: string): string {
  for (const entry of readdirSync(extractDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = join(extractDir, entry.name);
    if (existsSync(join(candidate, 'SKILL.md'))) return candidate;
  }
  if (existsSync(join(extractDir, 'SKILL.md'))) return extractDir;
  throw new Error('skill 包中未找到 SKILL.md');
}

function writeSkillTree(slug: string, sourceRoot: string): void {
  const target = getConnectorSkillCacheDir(slug);
  mkdirSync(getConnectorSkillsCacheDir(), { recursive: true });
  rmSync(target, { recursive: true, force: true });
  cpSync(sourceRoot, target, { recursive: true });
  if (!existsSync(join(target, 'SKILL.md'))) {
    throw new Error(`skill 安装失败：${target} 缺少 SKILL.md`);
  }
}

async function installPackageSkill(
  slug: string,
  packageUrl: string,
  onProgress?: (message: string) => void,
): Promise<void> {
  onProgress?.('正在下载 skill…');
  const tmpRoot = await mkdtemp(join(tmpdir(), 'stoclaw-connector-skill-'));
  const lower = packageUrl.toLowerCase();
  const archivePath = join(tmpRoot, lower.endsWith('.zip') ? 'skill.zip' : 'skill.tgz');
  try {
    let remoteRevision: string | null = null;
    if (/gitlab\.sto\.cn/i.test(packageUrl)) {
      const result = await downloadViaNodeHttp(packageUrl, archivePath);
      remoteRevision = result.revision;
    } else {
      await downloadPackageToFile(packageUrl, archivePath);
    }

    const local = readSkillRevision(slug);
    if (
      connectorSkillInstalled(slug)
      && remoteRevision
      && !shouldUpdateSkillRevision(local?.revision, remoteRevision)
    ) {
      return;
    }

    onProgress?.('正在安装 skill…');
    const extractDir = join(tmpRoot, 'extract');
    mkdirSync(extractDir, { recursive: true });
    if (lower.endsWith('.zip')) {
      await extractZip(archivePath, extractDir);
    } else {
      extractTarGz(archivePath, extractDir);
    }
    writeSkillTree(slug, findSkillRoot(extractDir));
    if (remoteRevision) {
      writeSkillRevision(slug, remoteRevision);
    }
  } finally {
    try {
      await rm(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

export async function installConnectorSkillPackage(options: {
  descriptor: ConnectorDescriptor;
  dwsManifest?: DwsBundledManifest | null;
  onProgress?: (message: string) => void;
}): Promise<void> {
  const slug = connectorSkillSlug(options.descriptor);
  if (!slug) return;

  const skill = resolveConnectorAgentSkillFromDescriptor(options.descriptor);
  const source = skill?.source ?? 'bundled';
  const installSpec = parseManagedCliInstallSpec(options.descriptor.runtime);

  if (source === 'package' && skill?.packageUrl) {
    await installPackageSkill(slug, skill.packageUrl, options.onProgress);
    return;
  }

  if (source === 'bundled' && options.dwsManifest) {
    await installDwsSkillPackageToConnectorCache({
      manifest: options.dwsManifest,
      skillSlug: slug,
      installSpec,
      onProgress: options.onProgress,
    });
    return;
  }

  if (source === 'bundled' && skill?.packageUrl) {
    await installPackageSkill(slug, skill.packageUrl, options.onProgress);
    return;
  }

  logger.warn(`[connectors] skip skill install for ${options.descriptor.id}: no package source`);
}
