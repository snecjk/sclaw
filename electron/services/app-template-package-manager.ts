import { app } from 'electron';
import { existsSync } from 'fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

import { extractZip as defaultExtractZip } from '../utils/zip-extract';
import {
  appTemplateApiClient,
  type AppTemplateDownloadInfo,
  type AppTemplatePageType,
  type AppTemplateSummary,
} from './app-template-api-client';

interface AppTemplatePackageManagerDeps {
  cacheRoot?: string;
  getDownloadInfo?: (templateId: string, version: string) => Promise<AppTemplateDownloadInfo>;
  fetchImpl?: typeof fetch;
  extractZip?: (zipPath: string, destination: string) => Promise<void>;
}

interface CachedTemplateMeta {
  templateId: string;
  version: string;
  pageType: AppTemplatePageType;
  packageOssKey: string;
  packageEtag: string | null;
  packageSize: number;
  fetchedAt: string;
}

const TEMPLATE_ID_PATTERN = /^(?:site-minimal|assets-minimal|[0-9A-HJKMNP-TV-Z]{26})$/;
const VERSION_PATTERN = /^1\.0\.\d+$/;

function validTemplateRoot(dir: string): boolean {
  const rootPackage = existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'src'));
  const legacyPackage = existsSync(join(dir, 'frontend', 'package.json'));
  return existsSync(join(dir, 'manifest.json')) && (rootPackage || legacyPackage);
}

function builtinTemplateResourcesRoot(): string {
  const candidates = [
    join(process.cwd(), 'resources', 'app-templates'),
    join(app.getAppPath(), 'resources', 'app-templates'),
    join(process.resourcesPath, 'resources', 'app-templates'),
    join(process.resourcesPath, 'app-templates'),
  ];
  const resolved = candidates.find((candidate) =>
    existsSync(join(candidate, 'site-minimal')) || existsSync(join(candidate, 'assets-minimal')),
  );
  if (!resolved) throw new Error('内置应用模板资源缺失');
  return resolved;
}

export function resolveLocalBuiltinTemplateDir(
  templateId: 'site-minimal' | 'assets-minimal',
  resourcesRoot = builtinTemplateResourcesRoot(),
): string {
  const resolved = join(resourcesRoot, templateId);
  if (!validTemplateRoot(resolved)) throw new Error(`内置模板资源缺失: ${templateId}`);
  return resolved;
}

export async function listLocalBuiltinAppTemplates(
  resourcesRoot: string | undefined,
  pageType?: AppTemplatePageType,
): Promise<AppTemplateSummary[]> {
  const pageTypes: AppTemplatePageType[] = pageType ? [pageType] : ['site', 'assets'];
  return Promise.all(pageTypes.map(async (currentPageType) => {
    const templateId = `${currentPageType}-minimal` as const;
    const root = resolveLocalBuiltinTemplateDir(templateId, resourcesRoot ?? builtinTemplateResourcesRoot());
    const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as {
      templateId?: string;
      pageType?: string;
      name?: string;
      description?: string;
    };
    if (manifest.templateId !== templateId || manifest.pageType !== currentPageType) {
      throw new Error(`内置模板 manifest.json 与资源目录不一致: ${templateId}`);
    }
    return {
      templateId,
      pageType: currentPageType,
      name: manifest.name?.trim() || templateId,
      description: manifest.description?.trim() || '',
      status: 'ACTIVE' as const,
      isBuiltin: true,
      latestVersion: 'local',
      createdAt: '',
      updatedAt: '',
      source: 'local-resource' as const,
    };
  }));
}

function normalizedEtag(value: string | null): string | null {
  if (!value) return null;
  return value.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
}

async function resolveExtractedRoot(extractDir: string): Promise<string> {
  if (validTemplateRoot(extractDir)) return extractDir;
  const entries = await readdir(extractDir, { withFileTypes: true });
  if (entries.length === 1 && entries[0]?.isDirectory()) {
    return join(extractDir, entries[0].name);
  }
  return extractDir;
}

async function validateManifest(
  templateRoot: string,
  templateId: string,
  pageType: AppTemplatePageType,
): Promise<void> {
  if (!validTemplateRoot(templateRoot)) {
    throw new Error('模板解压后缺少 manifest.json、package.json 或工程源码');
  }
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await readFile(join(templateRoot, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  } catch (error) {
    throw new Error('模板 manifest.json 不是合法 JSON', { cause: error });
  }
  if (
    manifest.schemaVersion !== 1 ||
    manifest.templateId !== templateId ||
    manifest.pageType !== pageType
  ) {
    throw new Error('manifest.json 与所选模板不一致');
  }
}

export class AppTemplatePackageManager {
  private readonly cacheRoot?: string;
  private readonly getDownloadInfo: AppTemplatePackageManagerDeps['getDownloadInfo'];
  private readonly fetchImpl: typeof fetch;
  private readonly extract: (zipPath: string, destination: string) => Promise<void>;
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(deps: AppTemplatePackageManagerDeps = {}) {
    this.cacheRoot = deps.cacheRoot;
    this.getDownloadInfo = deps.getDownloadInfo ?? (
      (templateId, version) => appTemplateApiClient.getDownloadInfo(templateId, version)
    );
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.extract = deps.extractZip ?? defaultExtractZip;
  }

  ensureTemplate(
    templateId: string,
    version: string,
    pageType: AppTemplatePageType,
  ): Promise<string> {
    if (!TEMPLATE_ID_PATTERN.test(templateId)) throw new Error('templateId 格式不合法');
    if (!VERSION_PATTERN.test(version)) throw new Error('模板 version 格式不合法');
    const cacheKey = `${pageType}:${templateId}:${version}`;
    const existing = this.inFlight.get(cacheKey);
    if (existing) return existing;
    const task = this.ensureTemplateImpl(templateId, version, pageType)
      .finally(() => this.inFlight.delete(cacheKey));
    this.inFlight.set(cacheKey, task);
    return task;
  }

  private async ensureTemplateImpl(
    templateId: string,
    version: string,
    pageType: AppTemplatePageType,
  ): Promise<string> {
    const cacheRoot = this.cacheRoot ?? join(app.getPath('userData'), 'app-templates');
    const cacheDir = join(cacheRoot, pageType, templateId, version);
    const metaPath = join(cacheDir, '.sclaw-template-meta.json');
    if (validTemplateRoot(cacheDir) && existsSync(metaPath)) {
      try {
        const meta = JSON.parse(await readFile(metaPath, 'utf8')) as CachedTemplateMeta;
        if (
          meta.templateId === templateId &&
          meta.version === version &&
          meta.pageType === pageType
        ) {
          await validateManifest(cacheDir, templateId, pageType);
          return cacheDir;
        }
      } catch {
        // Invalid cache is refreshed below.
      }
    }

    const info = await this.getDownloadInfo!(templateId, version);
    if (info.templateId !== templateId || info.version !== version) {
      throw new Error('模板下载信息与所选版本不一致');
    }
    const response = await this.fetchImpl(info.downloadUrl, { method: 'GET' });
    if (!response.ok) throw new Error(`下载应用模板失败: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== info.packageSize) {
      throw new Error(`模板包大小不一致: expected=${info.packageSize}, actual=${bytes.byteLength}`);
    }
    const responseEtag = normalizedEtag(response.headers.get('etag'));
    const expectedEtag = normalizedEtag(info.packageEtag);
    if (responseEtag && expectedEtag && responseEtag !== expectedEtag) {
      throw new Error('模板包 ETag 与服务端元数据不一致');
    }

    const stagingRoot = await mkdtemp(join(tmpdir(), 'sclaw-app-template-'));
    const zipPath = join(stagingRoot, 'template.zip');
    const extractDir = join(stagingRoot, 'extract');
    try {
      await mkdir(extractDir, { recursive: true });
      await writeFile(zipPath, bytes);
      await this.extract(zipPath, extractDir);
      const templateRoot = await resolveExtractedRoot(extractDir);
      await validateManifest(templateRoot, templateId, pageType);

      await rm(cacheDir, { recursive: true, force: true });
      await mkdir(dirname(cacheDir), { recursive: true });
      await cp(templateRoot, cacheDir, { recursive: true });
      const meta: CachedTemplateMeta = {
        templateId,
        version,
        pageType,
        packageOssKey: info.packageOssKey,
        packageEtag: info.packageEtag,
        packageSize: info.packageSize,
        fetchedAt: new Date().toISOString(),
      };
      await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
      return cacheDir;
    } finally {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export const appTemplatePackageManager = new AppTemplatePackageManager();
