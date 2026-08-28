import { describe, expect, it } from 'vitest';
import { buildCodeApplicationCreateArgs } from '@electron/services/code-application-create-command';

describe('buildCodeApplicationCreateArgs', () => {
  it('passes assets through to the sai-cli create command', () => {
    expect(buildCodeApplicationCreateArgs({
      applicationUid: '01K00000000000000000000000',
      applicationCode: 'asset-app',
      applicationName: '资源应用',
      description: '资源应用说明',
      pageType: 'assets',
    })).toEqual([
      'policy', 'code-application', 'create',
      '--applicationUid', '01K00000000000000000000000',
      '--applicationCode', 'asset-app',
      '--applicationName', '资源应用',
      '--pageType', 'assets',
      '--description', '资源应用说明',
    ]);
  });

  it('defaults invalid or omitted pageType to site', () => {
    expect(buildCodeApplicationCreateArgs({
      applicationUid: '01K00000000000000000000000',
      applicationCode: 'site-app',
      applicationName: '站点应用',
    })).toContain('site');
  });
});
