import { mkdir, mkdtemp, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppTemplatePackageManager } from '../../electron/services/app-template-package-manager';

const roots: string[] = [];

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'app-template-manager-test-'));
  roots.push(value);
  return value;
}

afterEach(async () => {
  const { rm } = await import('fs/promises');
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

describe('AppTemplatePackageManager', () => {
  it('按 templateId/version 下载、校验并缓存模板', async () => {
    const cacheRoot = await root();
    const packageBytes = new Uint8Array([1, 2, 3, 4]);
    const getDownloadInfo = vi.fn().mockResolvedValue({
      templateId: 'site-minimal',
      version: '1.0.0',
      packageOssKey: 'ai-memory-center/app-templates/site/site-minimal/1.0.0/template.zip',
      packageEtag: 'etag-1',
      packageSize: packageBytes.byteLength,
      downloadUrl: 'https://oss.example.test/template.zip',
      expiresAt: '2026-08-26T01:00:00Z',
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(packageBytes, {
      status: 200,
      headers: { ETag: '"etag-1"' },
    }));
    const extract = vi.fn(async (_zipPath: string, extractDir: string) => {
      await mkdir(join(extractDir, 'src'), { recursive: true });
      await writeFile(join(extractDir, 'package.json'), '{}');
      await writeFile(join(extractDir, 'src', 'main.tsx'), 'export default null');
      await writeFile(join(extractDir, 'manifest.json'), JSON.stringify({
        schemaVersion: 1,
        templateId: 'site-minimal',
        pageType: 'site',
        name: '标准 Site 模版',
      }));
    });
    const manager = new AppTemplatePackageManager({
      cacheRoot,
      getDownloadInfo,
      fetchImpl,
      extractZip: extract,
    });

    const first = await manager.ensureTemplate('site-minimal', '1.0.0', 'site');
    const second = await manager.ensureTemplate('site-minimal', '1.0.0', 'site');

    expect(first).toBe(second);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(extract).toHaveBeenCalledOnce();
    const meta = JSON.parse(await readFile(join(first, '.sclaw-template-meta.json'), 'utf8'));
    expect(meta).toMatchObject({
      templateId: 'site-minimal',
      version: '1.0.0',
      pageType: 'site',
      packageOssKey: expect.stringContaining('/site-minimal/1.0.0/'),
      packageEtag: 'etag-1',
      packageSize: 4,
    });
  });

  it('拒绝下载大小与服务端元数据不一致的包', async () => {
    const manager = new AppTemplatePackageManager({
      cacheRoot: await root(),
      getDownloadInfo: vi.fn().mockResolvedValue({
        templateId: 'assets-minimal',
        version: '1.0.0',
        packageOssKey: 'key',
        packageEtag: null,
        packageSize: 5,
        downloadUrl: 'https://oss.example.test/template.zip',
        expiresAt: '2026-08-26T01:00:00Z',
      }),
      fetchImpl: vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]))),
      extractZip: vi.fn(),
    });

    await expect(manager.ensureTemplate('assets-minimal', '1.0.0', 'assets'))
      .rejects.toThrow('模板包大小不一致');
  });

  it('拒绝 manifest 与所选模板不一致', async () => {
    const cacheRoot = await root();
    const manager = new AppTemplatePackageManager({
      cacheRoot,
      getDownloadInfo: vi.fn().mockResolvedValue({
        templateId: 'site-minimal',
        version: '1.0.0',
        packageOssKey: 'key',
        packageEtag: null,
        packageSize: 1,
        downloadUrl: 'https://oss.example.test/template.zip',
        expiresAt: '2026-08-26T01:00:00Z',
      }),
      fetchImpl: vi.fn().mockResolvedValue(new Response(new Uint8Array([1]))),
      extractZip: vi.fn(async (_zipPath: string, extractDir: string) => {
        await mkdir(join(extractDir, 'src'), { recursive: true });
        await writeFile(join(extractDir, 'package.json'), '{}');
        await writeFile(join(extractDir, 'src', 'main.tsx'), 'export default null');
        await writeFile(join(extractDir, 'manifest.json'), JSON.stringify({
          schemaVersion: 1,
          templateId: 'assets-minimal',
          pageType: 'assets',
          name: '错误模板',
        }));
      }),
    });

    await expect(manager.ensureTemplate('site-minimal', '1.0.0', 'site'))
      .rejects.toThrow('manifest.json 与所选模板不一致');
  });
});
