import { describe, expect, it } from 'vitest';
import { normalizeSiteApp, parseSiteAppDetail } from '../../shared/site-app-catalog';

describe('site-app-catalog', () => {
  it('maps portal_url and permissions_url from memory-center detail payload', () => {
    const record = parseSiteAppDetail({
      success: true,
      data: {
        app_code: 'app_test',
        name: '测试建站',
        page_type: 'site',
        portal_url: 'https://sclaw-test.sto.cn/apps/app_test',
        permissions_url: 'https://sclaw-test.sto.cn/permissions?appId=app_test&embed=1',
      },
    });
    expect(record).toMatchObject({
      appCode: 'app_test',
      applicationName: '测试建站',
      pageType: 'site',
      previewUrl: 'https://sclaw-test.sto.cn/apps/app_test',
      permissionsUrl: 'https://sclaw-test.sto.cn/permissions?appId=app_test&embed=1',
    });
  });

  it('prefers explicit preview_url over portal_url', () => {
    const record = normalizeSiteApp({
      app_code: 'app_test',
      preview_url: 'https://preview.example.cn',
      portal_url: 'https://portal.example.cn',
    });
    expect(record?.previewUrl).toBe('https://preview.example.cn');
  });
});
