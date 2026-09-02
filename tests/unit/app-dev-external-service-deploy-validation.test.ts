import { describe, expect, it, vi } from 'vitest';

import { assertExternalServicesReadyForDeploy } from '@electron/services/app-dev-deploy-preflight';

describe('external service deploy preflight', () => {
  it('生成物漂移时以 400 阻断发布', async () => {
    const validate = vi.fn().mockResolvedValue({
      valid: false,
      errors: ['src/sclaw/services.generated.ts 与绑定配置不一致'],
      serviceCount: 1,
    });

    await expect(assertExternalServicesReadyForDeploy('/apps/demo', validate))
      .rejects.toMatchObject({
        message: expect.stringContaining('services.generated.ts'),
        statusCode: 400,
      });
  });

  it('配置一致时允许继续发布', async () => {
    const validate = vi.fn().mockResolvedValue({ valid: true, errors: [], serviceCount: 2 });
    await expect(assertExternalServicesReadyForDeploy('/apps/demo', validate))
      .resolves.toMatchObject({ valid: true, serviceCount: 2 });
  });
});
