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

  it('exposes both resources templates when no page type filter is selected', async () => {
    const items = await listLocalBuiltinAppTemplates(
      join(process.cwd(), 'resources', 'app-templates'),
    );

    expect(items.map((item) => ({
      templateId: item.templateId,
      pageType: item.pageType,
      source: item.source,
    }))).toEqual([
      { templateId: 'assets-minimal', pageType: 'assets', source: 'local-resource' },
      { templateId: 'site-minimal', pageType: 'site', source: 'local-resource' },
      { templateId: 'react-a2ui-template', pageType: 'site', source: 'local-resource' },
    ]);
  });

  it('lists both site local templates for 独立站点', async () => {
    const items = await listLocalBuiltinAppTemplates(
      join(process.cwd(), 'resources', 'app-templates'),
      'site',
    );
    expect(items.map((item) => item.templateId)).toEqual([
      'site-minimal',
      'react-a2ui-template',
    ]);
  });
});
