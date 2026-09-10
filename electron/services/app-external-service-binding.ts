import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type {
  ExternalServiceBindingSnapshot,
  ExternalServicesManifest,
  ExternalServiceVersionConfig,
} from '../../shared/external-service-contract';
import { externalServiceApiClient } from './external-service-api-client';

const ALIAS_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const MANIFEST_PATH = 'contracts/external-services.v1.json';
const PROXY_PATH = 'contracts/dev-proxy.v1.json';
const GENERATED_PATH = 'src/sclaw/services.generated.ts';
const CHANGED_FILES = [MANIFEST_PATH, PROXY_PATH, GENERATED_PATH];

type ProxyEntry = {
  key: string;
  target: string;
  changeOrigin?: boolean;
  managedBy?: string;
  serviceId?: string;
  serviceUid?: string;
};

type DevProxyManifest = { version: string; proxies: ProxyEntry[] };

type BindingDependencies = {
  getVersion?: (serviceUid: string, version: string) => Promise<ExternalServiceVersionConfig>;
  resolveLegacyVersion?: (serviceId: string, version: string) => Promise<ExternalServiceVersionConfig>;
  installNpmPackage?: (appPath: string, packageName: string) => Promise<{ packageName: string; output: string }>;
};

async function defaultInstallNpmPackage(appPath: string, packageName: string) {
  const { installNpmPackage } = await import('./app-dev-service');
  return installNpmPackage(appPath, packageName);
}

type BindInput = {
  appPath: string;
  serviceUid: string;
  version: string;
  alias: string;
  resolvedConfig?: ExternalServiceVersionConfig;
};
type UpgradeInput = {
  appPath: string;
  alias: string;
  version: string;
  resolvedConfig?: ExternalServiceVersionConfig;
};
type RemoveInput = { appPath: string; alias: string };

export type ExternalServiceWorkspaceValidation = {
  valid: boolean;
  errors: string[];
  serviceCount: number;
};

function assertAlias(alias: string): void {
  if (!ALIAS_RE.test(alias)) throw new Error('alias 必须是合法的 JavaScript 标识符');
}

function assertSafeSnapshot(config: ExternalServiceVersionConfig): void {
  if (config.schemaVersion !== 'external-service/v1') {
    throw new Error('外部服务 schemaVersion 不受支持');
  }
  if (!config.serviceId || !config.serviceUid || !/^1\.0\.\d+$/.test(config.version)) {
    throw new Error('外部服务 serviceId、serviceUid 或 version 不合法');
  }
  if (!['none', 'stoToken'].includes(config.auth?.type)) {
    throw new Error('外部服务认证方式不受支持');
  }
  for (const env of ['daily', 'stage', 'online'] as const) {
    const url = new URL(config.environments[env]);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error(`${env} 地址必须是无凭据、Query、Fragment 的 HTTPS baseUrl`);
    }
    if (
      config.auth.type === 'stoToken'
      && url.hostname !== 'sto.cn'
      && !url.hostname.endsWith('.sto.cn')
    ) {
      throw new Error('stoToken 只能发送到 STO 域名');
    }
  }
  const integration = config.integration;
  if (integration && Boolean(integration.npmPackage) !== Boolean(integration.packageVersion)) {
    throw new Error('npmPackage 和 packageVersion 必须同时填写');
  }
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function loadManifest(appPath: string): Promise<ExternalServicesManifest> {
  const raw = await readOptional(join(appPath, MANIFEST_PATH));
  if (raw === null) return { schemaVersion: 'external-services/v1', services: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('external-services.v1.json 不是有效 JSON');
  }
  const value = parsed as Partial<ExternalServicesManifest>;
  if (value.schemaVersion !== 'external-services/v1' || !Array.isArray(value.services)) {
    throw new Error('external-services.v1.json 结构不合法');
  }
  for (const service of value.services) {
    assertAlias(service.alias);
    assertSafeSnapshot(service);
  }
  const aliases = value.services.map((item) => item.alias);
  const serviceUids = value.services.map((item) => item.serviceUid);
  if (new Set(aliases).size !== aliases.length || new Set(serviceUids).size !== serviceUids.length) {
    throw new Error('外部服务绑定存在重复 alias 或 serviceUid');
  }
  return { schemaVersion: 'external-services/v1', services: [...value.services] };
}

/**
 * 将 company scope 重构前只保存 serviceId 的旧快照提升为当前不可变快照。
 * 仅在读取到旧格式时访问服务中心并写回；新格式不会产生额外网络请求或文件改动。
 */
async function migrateLegacyManifest(
  appPath: string,
  resolveLegacyVersion: (serviceId: string, version: string) => Promise<ExternalServiceVersionConfig>,
): Promise<ExternalServicesManifest> {
  const raw = await readOptional(join(appPath, MANIFEST_PATH));
  if (raw === null) return { schemaVersion: 'external-services/v1', services: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('external-services.v1.json 不是有效 JSON');
  }
  const value = parsed as Partial<ExternalServicesManifest>;
  if (value.schemaVersion !== 'external-services/v1' || !Array.isArray(value.services)) {
    throw new Error('external-services.v1.json 结构不合法');
  }
  if (value.services.every((service) => Boolean(service.serviceUid))) {
    return loadManifest(appPath);
  }

  const services: ExternalServiceBindingSnapshot[] = [];
  for (const rawService of value.services) {
    const service = rawService as Partial<ExternalServiceBindingSnapshot>;
    assertAlias(service.alias ?? '');
    if (service.serviceUid) {
      assertSafeSnapshot(service as ExternalServiceVersionConfig);
      services.push(service as ExternalServiceBindingSnapshot);
      continue;
    }
    if (service.schemaVersion !== 'external-service/v1' || !service.serviceId || !service.version) {
      throw new Error('旧外部服务绑定缺少 serviceId 或 version，无法自动升级');
    }
    const resolved = await resolveLegacyVersion(service.serviceId, service.version);
    assertSafeSnapshot(resolved);
    if (resolved.serviceId !== service.serviceId || resolved.version !== service.version) {
      throw new Error('旧外部服务绑定解析结果与原 serviceId 或 version 不一致');
    }
    services.push({ ...resolved, alias: service.alias! });
  }

  const aliases = services.map((item) => item.alias);
  const serviceUids = services.map((item) => item.serviceUid);
  if (new Set(aliases).size !== aliases.length || new Set(serviceUids).size !== serviceUids.length) {
    throw new Error('升级后的外部服务绑定存在重复 alias 或 serviceUid');
  }
  const manifest: ExternalServicesManifest = { schemaVersion: 'external-services/v1', services };
  await writeFiles(appPath, renderFiles(manifest, await loadProxy(appPath)));
  return manifest;
}

async function loadProxy(appPath: string): Promise<DevProxyManifest> {
  const raw = await readOptional(join(appPath, PROXY_PATH));
  if (raw === null) return { version: 'v1', proxies: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('dev-proxy.v1.json 不是有效 JSON');
  }
  const value = parsed as Partial<DevProxyManifest>;
  if (!Array.isArray(value.proxies)) throw new Error('dev-proxy.v1.json 结构不合法');
  for (const entry of value.proxies) {
    if (!entry || typeof entry.key !== 'string' || typeof entry.target !== 'string') {
      throw new Error('dev-proxy.v1.json 包含非法代理条目');
    }
  }
  return { version: typeof value.version === 'string' ? value.version : 'v1', proxies: value.proxies };
}

function renderFiles(manifest: ExternalServicesManifest, proxy: DevProxyManifest) {
  const sorted = [...manifest.services].sort((a, b) => a.alias.localeCompare(b.alias));
  const manual = proxy.proxies.filter((entry) => entry.managedBy !== 'external-services');
  const manualKeys = new Set(manual.map((entry) => entry.key));
  const collision = sorted.find((service) => manualKeys.has(service.alias));
  if (collision) throw new Error(`代理 key「${collision.alias}」已被人工配置占用，请修改 alias`);
  const managed: ProxyEntry[] = sorted.map((service) => ({
    key: service.alias,
    target: service.environments.daily,
    changeOrigin: true,
    managedBy: 'external-services',
    serviceId: service.serviceId,
    serviceUid: service.serviceUid,
  }));
  const normalizedManifest: ExternalServicesManifest = {
    schemaVersion: 'external-services/v1',
    services: sorted,
  };
  const lines = sorted.length > 0
    ? [
        '// AUTO-GENERATED by SClaw. Do not edit.',
        "import { createExternalServiceClient } from './external-service-runtime';",
        '',
        'export const services = {',
        ...sorted.map((service) => `  ${service.alias}: createExternalServiceClient('${service.alias}'),`),
        '} as const;',
        '',
      ]
    : ['// AUTO-GENERATED by SClaw. Do not edit.', 'export const services = {} as const;', ''];
  return {
    manifest: `${JSON.stringify(normalizedManifest, null, 2)}\n`,
    proxy: `${JSON.stringify({ version: proxy.version, proxies: [...manual, ...managed] }, null, 2)}\n`,
    generated: lines.join('\n'),
  };
}

function proxiesEqualIgnoringOrder(actual: DevProxyManifest, expected: DevProxyManifest): boolean {
  if (actual.version !== expected.version || actual.proxies.length !== expected.proxies.length) return false;
  const normalize = (entries: ProxyEntry[]) => entries
    .map((entry) => JSON.stringify(Object.fromEntries(
      Object.entries(entry).sort(([left], [right]) => left.localeCompare(right)),
    )))
    .sort();
  return JSON.stringify(normalize(actual.proxies)) === JSON.stringify(normalize(expected.proxies));
}

async function writeFiles(appPath: string, files: ReturnType<typeof renderFiles>): Promise<void> {
  const entries = [
    [MANIFEST_PATH, files.manifest],
    [PROXY_PATH, files.proxy],
    [GENERATED_PATH, files.generated],
  ] as const;
  const temps: Array<[string, string]> = [];
  try {
    for (const [relativePath, content] of entries) {
      const target = join(appPath, relativePath);
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      await writeFile(temporary, content, 'utf8');
      temps.push([temporary, target]);
    }
    for (const [temporary, target] of temps) await rename(temporary, target);
  } finally {
    await Promise.all(temps.map(([temporary]) => rm(temporary, { force: true })));
  }
}

export function createBindingService(deps: BindingDependencies = {}) {
  const getVersion = deps.getVersion
    ?? ((serviceUid: string, version: string) => externalServiceApiClient.getVersion(serviceUid, version));
  const resolveLegacyVersion = deps.resolveLegacyVersion
    ?? ((serviceId: string, version: string) => externalServiceApiClient.resolveLegacyVersion(serviceId, version));
  const installNpmPackage = deps.installNpmPackage ?? defaultInstallNpmPackage;

  const ensureCurrentManifest = (appPath: string) => migrateLegacyManifest(appPath, resolveLegacyVersion);

  async function bind(input: BindInput) {
    assertAlias(input.alias);
    const [manifest, proxy, config] = await Promise.all([
      ensureCurrentManifest(input.appPath),
      loadProxy(input.appPath),
      input.resolvedConfig ?? getVersion(input.serviceUid, input.version),
    ]);
    assertSafeSnapshot(config);
    if (config.serviceUid !== input.serviceUid || config.version !== input.version) {
      throw new Error('外部服务版本响应与请求不一致');
    }
    if (manifest.services.some((item) => item.alias === input.alias || item.serviceUid === input.serviceUid)) {
      throw new Error('外部服务 alias 或 serviceUid 已绑定');
    }
    const integration = config.integration;
    const installed = integration?.npmPackage && integration.packageVersion
      ? await installNpmPackage(input.appPath, `${integration.npmPackage}@${integration.packageVersion}`)
      : null;
    const binding: ExternalServiceBindingSnapshot = { ...config, alias: input.alias };
    const next = { ...manifest, services: [...manifest.services, binding] };
    await writeFiles(input.appPath, renderFiles(next, proxy));
    return {
      binding,
      changedFiles: [...CHANGED_FILES],
      installedPackage: installed?.packageName ?? null,
      usageGuide: integration?.usageGuide ?? null,
    };
  }

  async function upgrade(input: UpgradeInput) {
    assertAlias(input.alias);
    const [manifest, proxy] = await Promise.all([ensureCurrentManifest(input.appPath), loadProxy(input.appPath)]);
    const existing = manifest.services.find((item) => item.alias === input.alias);
    if (!existing) throw new Error('外部服务绑定不存在');
    const config = input.resolvedConfig ?? await getVersion(existing.serviceUid, input.version);
    assertSafeSnapshot(config);
    if (config.serviceUid !== existing.serviceUid || config.version !== input.version) {
      throw new Error('外部服务版本响应与请求不一致');
    }
    const integration = config.integration;
    const installed = integration?.npmPackage && integration.packageVersion
      ? await installNpmPackage(input.appPath, `${integration.npmPackage}@${integration.packageVersion}`)
      : null;
    const binding: ExternalServiceBindingSnapshot = { ...config, alias: input.alias };
    const next = {
      ...manifest,
      services: manifest.services.map((item) => item.alias === input.alias ? binding : item),
    };
    await writeFiles(input.appPath, renderFiles(next, proxy));
    return { binding, changedFiles: [...CHANGED_FILES], installedPackage: installed?.packageName ?? null };
  }

  async function remove(input: RemoveInput) {
    assertAlias(input.alias);
    const [manifest, proxy] = await Promise.all([ensureCurrentManifest(input.appPath), loadProxy(input.appPath)]);
    if (!manifest.services.some((item) => item.alias === input.alias)) {
      throw new Error('外部服务绑定不存在');
    }
    const next = { ...manifest, services: manifest.services.filter((item) => item.alias !== input.alias) };
    await writeFiles(input.appPath, renderFiles(next, proxy));
    return { alias: input.alias, changedFiles: [...CHANGED_FILES] };
  }

  async function list(appPath: string) {
    return (await ensureCurrentManifest(appPath)).services;
  }

  async function validate(appPath: string): Promise<ExternalServiceWorkspaceValidation> {
    try {
      const [manifestRaw, generatedRaw, proxy] = await Promise.all([
        readOptional(join(appPath, MANIFEST_PATH)),
        readOptional(join(appPath, GENERATED_PATH)),
        loadProxy(appPath),
      ]);
      if (manifestRaw === null && generatedRaw === null) {
        const hasManagedProxy = proxy.proxies.some((entry) => entry.managedBy === 'external-services');
        return hasManagedProxy
          ? { valid: false, errors: ['外部服务代理存在，但绑定配置缺失'], serviceCount: 0 }
          : { valid: true, errors: [], serviceCount: 0 };
      }
      const manifest = await ensureCurrentManifest(appPath);
      const expected = renderFiles(manifest, proxy);
      const actual = await Promise.all(CHANGED_FILES.map((path) => readOptional(join(appPath, path))));
      const expectedValues = [expected.manifest, expected.proxy, expected.generated];
      const expectedProxy = JSON.parse(expected.proxy) as DevProxyManifest;
      const errors = CHANGED_FILES.flatMap((path, index) => {
        const matches = path === PROXY_PATH
          ? proxiesEqualIgnoringOrder(proxy, expectedProxy)
          : actual[index] === expectedValues[index];
        return matches ? [] : [`${path} 与绑定配置不一致`];
      });
      return { valid: errors.length === 0, errors, serviceCount: manifest.services.length };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : String(error)],
        serviceCount: 0,
      };
    }
  }

  return { bind, upgrade, remove, list, validate };
}

export const appExternalServiceBinding = createBindingService();
export const listExternalServiceBindings = appExternalServiceBinding.list;
export const bindExternalService = appExternalServiceBinding.bind;
export const upgradeExternalService = appExternalServiceBinding.upgrade;
export const removeExternalService = appExternalServiceBinding.remove;
export const validateExternalServiceWorkspace = appExternalServiceBinding.validate;
