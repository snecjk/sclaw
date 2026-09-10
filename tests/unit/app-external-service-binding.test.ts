import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExternalServiceVersionConfig } from '../../shared/external-service-contract';
import { createBindingService } from '../../electron/services/app-external-service-binding';

const roots: string[] = [];
const POLICY_VERSION: ExternalServiceVersionConfig = {
  schemaVersion: 'external-service/v1',
  serviceId: 'sto-policy-ontology',
  serviceUid: 'platform-policy-ontology',
  scopeType: 'PLATFORM',
  companyCode: '__PLATFORM__',
  visibility: 'PUBLIC',
  version: '1.0.0',
  name: '策略本体服务',
  description: '提供策略本体查询能力',
  owner: 'policy-platform',
  environments: {
    daily: 'https://zc-hybrid-test.sto.cn/sto-policy/api',
    stage: 'https://zc-hybrid-stage.sto.cn/sto-policy/api',
    online: 'https://zc-hybrid.sto.cn/sto-policy/api',
  },
  auth: { type: 'stoToken' },
  integration: {
    npmPackage: '@sto/sclaw-plugin-policy-ontology',
    packageVersion: '1.0.0',
    usageGuide: '导入 createOntologyClient。',
  },
};

async function createTempApp(): Promise<string> {
  const appPath = await mkdtemp(join(tmpdir(), 'sclaw-external-service-'));
  roots.push(appPath);
  await mkdir(join(appPath, 'contracts'), { recursive: true });
  await mkdir(join(appPath, 'src/sclaw'), { recursive: true });
  await writeFile(
    join(appPath, 'contracts/dev-proxy.v1.json'),
    JSON.stringify({ version: 'v1', proxies: [{ key: 'manual', target: 'https://manual.sto.cn' }] }, null, 2) + '\n',
  );
  return appPath;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('app external service binding', () => {
  it('未启用外部服务的旧应用通过发布校验', async () => {
    const appPath = await createTempApp();
    const service = createBindingService();
    await expect(service.validate(appPath)).resolves.toEqual({
      valid: true,
      errors: [],
      serviceCount: 0,
    });
  });

  it('打开旧 serviceId 绑定时解析 serviceUid 并原子升级关联文件', async () => {
    const appPath = await createTempApp();
    await writeFile(join(appPath, 'contracts/external-services.v1.json'), `${JSON.stringify({
      schemaVersion: 'external-services/v1',
      services: [{
        schemaVersion: 'external-service/v1',
        serviceId: POLICY_VERSION.serviceId,
        version: POLICY_VERSION.version,
        alias: 'policy',
        name: '旧服务',
        environments: POLICY_VERSION.environments,
        auth: POLICY_VERSION.auth,
      }],
    }, null, 2)}\n`);
    const resolveLegacyVersion = vi.fn().mockResolvedValue(POLICY_VERSION);
    const service = createBindingService({ resolveLegacyVersion });

    await expect(service.list(appPath)).resolves.toMatchObject([{
      alias: 'policy',
      serviceUid: POLICY_VERSION.serviceUid,
      companyCode: '__PLATFORM__',
    }]);
    expect(resolveLegacyVersion).toHaveBeenCalledWith(POLICY_VERSION.serviceId, POLICY_VERSION.version);

    const manifest = JSON.parse(await readFile(join(appPath, 'contracts/external-services.v1.json'), 'utf8'));
    const proxy = JSON.parse(await readFile(join(appPath, 'contracts/dev-proxy.v1.json'), 'utf8'));
    expect(manifest.services[0]).toMatchObject({ serviceUid: POLICY_VERSION.serviceUid, visibility: 'PUBLIC' });
    expect(proxy.proxies).toContainEqual(expect.objectContaining({
      key: 'policy', serviceUid: POLICY_VERSION.serviceUid, managedBy: 'external-services',
    }));
    expect(await service.validate(appPath)).toMatchObject({ valid: true, serviceCount: 1 });
  });

  it('写入固定版本快照并生成 daily 代理和调用入口', async () => {
    const appPath = await createTempApp();
    const install = vi.fn().mockResolvedValue({
      packageName: '@sto/sclaw-plugin-policy-ontology@1.0.0',
      output: '',
    });
    const service = createBindingService({
      getVersion: vi.fn().mockResolvedValue(POLICY_VERSION),
      installNpmPackage: install,
    });

    const result = await service.bind({
      appPath,
      serviceUid: POLICY_VERSION.serviceUid,
      version: '1.0.0',
      alias: 'policyOntology',
    });

    const manifest = JSON.parse(await readFile(join(appPath, 'contracts/external-services.v1.json'), 'utf8'));
    const proxy = JSON.parse(await readFile(join(appPath, 'contracts/dev-proxy.v1.json'), 'utf8'));
    const generated = await readFile(join(appPath, 'src/sclaw/services.generated.ts'), 'utf8');
    expect(manifest.services[0]).toMatchObject({
      alias: 'policyOntology',
      serviceId: 'sto-policy-ontology',
      version: '1.0.0',
    });
    expect(proxy.proxies).toContainEqual(expect.objectContaining({
      key: 'policyOntology',
      target: POLICY_VERSION.environments.daily,
      managedBy: 'external-services',
    }));
    expect(proxy.proxies).toContainEqual(expect.objectContaining({ key: 'manual' }));
    expect(generated).toContain("policyOntology: createExternalServiceClient('policyOntology')");
    expect(install).toHaveBeenCalledWith(appPath, '@sto/sclaw-plugin-policy-ontology@1.0.0');
    expect(result.changedFiles).toHaveLength(3);
  });

  it('拒绝把 stoToken 绑定到非 STO 域名', async () => {
    const appPath = await createTempApp();
    const service = createBindingService({
      getVersion: vi.fn().mockResolvedValue({
        ...POLICY_VERSION,
        serviceId: 'evil', serviceUid: 'evil-service',
        environments: { ...POLICY_VERSION.environments, online: 'https://evil.example/api' },
      }),
      installNpmPackage: vi.fn(),
    });
    await expect(service.bind({
      appPath,
      serviceUid: 'evil-service',
      version: '1.0.0',
      alias: 'evil',
    })).rejects.toThrow('stoToken');
  });

  it('升级不修改旧文件直到远端版本和安装都成功', async () => {
    const appPath = await createTempApp();
    const getVersion = vi.fn().mockResolvedValue(POLICY_VERSION);
    const install = vi.fn().mockResolvedValue({ packageName: 'sdk', output: '' });
    const service = createBindingService({ getVersion, installNpmPackage: install });
    await service.bind({ appPath, serviceUid: POLICY_VERSION.serviceUid, version: '1.0.0', alias: 'policy' });
    const before = await readFile(join(appPath, 'contracts/external-services.v1.json'), 'utf8');
    install.mockRejectedValueOnce(new Error('install failed'));
    getVersion.mockResolvedValueOnce({ ...POLICY_VERSION, version: '1.0.1' });

    await expect(service.upgrade({ appPath, alias: 'policy', version: '1.0.1' })).rejects.toThrow('install failed');
    expect(await readFile(join(appPath, 'contracts/external-services.v1.json'), 'utf8')).toBe(before);
  });

  it('移除绑定时只清理托管代理并能检测生成物漂移', async () => {
    const appPath = await createTempApp();
    const service = createBindingService({
      getVersion: vi.fn().mockResolvedValue(POLICY_VERSION),
      installNpmPackage: vi.fn().mockResolvedValue({ packageName: 'sdk', output: '' }),
    });
    await service.bind({ appPath, serviceUid: POLICY_VERSION.serviceUid, version: '1.0.0', alias: 'policy' });
    await writeFile(join(appPath, 'src/sclaw/services.generated.ts'), '// drift\n');
    expect((await service.validate(appPath)).valid).toBe(false);

    await service.remove({ appPath, alias: 'policy' });
    const proxy = JSON.parse(await readFile(join(appPath, 'contracts/dev-proxy.v1.json'), 'utf8'));
    expect(proxy.proxies).toEqual([{ key: 'manual', target: 'https://manual.sto.cn' }]);
    expect((await service.validate(appPath)).valid).toBe(true);
  });

  it('允许在已托管代理后追加人工代理', async () => {
    const appPath = await createTempApp();
    const service = createBindingService({
      getVersion: vi.fn().mockResolvedValue(POLICY_VERSION),
      installNpmPackage: vi.fn().mockResolvedValue({ packageName: 'sdk', output: '' }),
    });
    await service.bind({ appPath, serviceUid: POLICY_VERSION.serviceUid, version: '1.0.0', alias: 'policy' });

    const proxyPath = join(appPath, 'contracts/dev-proxy.v1.json');
    const proxy = JSON.parse(await readFile(proxyPath, 'utf8'));
    proxy.proxies.push({
      key: 'siteapp-menu',
      target: 'https://baseinfo-aimemory-test.sto.cn',
      changeOrigin: true,
    });
    await writeFile(proxyPath, `${JSON.stringify(proxy, null, 2)}\n`);

    await expect(service.validate(appPath)).resolves.toEqual({
      valid: true,
      errors: [],
      serviceCount: 1,
    });
  });

  it('仍然拒绝被篡改的托管代理', async () => {
    const appPath = await createTempApp();
    const service = createBindingService({
      getVersion: vi.fn().mockResolvedValue(POLICY_VERSION),
      installNpmPackage: vi.fn().mockResolvedValue({ packageName: 'sdk', output: '' }),
    });
    await service.bind({ appPath, serviceUid: POLICY_VERSION.serviceUid, version: '1.0.0', alias: 'policy' });

    const proxyPath = join(appPath, 'contracts/dev-proxy.v1.json');
    const proxy = JSON.parse(await readFile(proxyPath, 'utf8'));
    proxy.proxies.find((entry: { key: string }) => entry.key === 'policy').target = 'https://wrong.sto.cn';
    await writeFile(proxyPath, `${JSON.stringify(proxy, null, 2)}\n`);

    const result = await service.validate(appPath);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('contracts/dev-proxy.v1.json 与绑定配置不一致');
  });
});
