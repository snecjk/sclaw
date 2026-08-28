import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('应用模板自包含接口契约', () => {
  it('固定声明模板、版本、OSS 和错误边界字段', async () => {
    const contract = JSON.parse(
      await readFile(join(process.cwd(), 'tests/fixtures/app-template-contract.json'), 'utf8'),
    ) as Record<string, any>;

    expect(contract.page.response.items[0]).toMatchObject({
      templateId: 'site-minimal',
      pageType: 'site',
      isBuiltin: true,
      latestVersion: '1.0.0',
    });
    expect(contract.publish.metadata).not.toHaveProperty('version');
    expect(contract.publish.metadata).not.toHaveProperty('isBuiltin');
    expect(contract.publish.response).toMatchObject({
      version: '1.0.0',
      packageOssKey: expect.any(String),
      packageEtag: 'etag-1',
      packageSize: 1024,
    });
    expect(contract.download.downloadUrl).toMatch(/^https:\/\//);
    expect(contract.errors).toMatchObject({
      business: { httpStatus: 422 },
      downloadExpired: { httpStatus: 403 },
      publishConflict: { httpStatus: 409 },
    });
  });
});
