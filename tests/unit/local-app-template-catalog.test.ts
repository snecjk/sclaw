import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { listLocalBuiltinAppTemplates } from '../../electron/services/app-template-package-manager';

describe('local built-in app template catalog', () => {
  it('exposes the requested resources template as a distinct local source', async () => {
    const items = await listLocalBuiltinAppTemplates(
      join(process.cwd(), 'resources', 'app-templates'),
      'assets',
    );

    expect(items).toEqual([
      expect.objectContaining({
        templateId: 'assets-minimal',
        pageType: 'assets',
        name: '最简托管应用',
        latestVersion: 'local',
        source: 'local-resource',
      }),
    ]);
  });
});
