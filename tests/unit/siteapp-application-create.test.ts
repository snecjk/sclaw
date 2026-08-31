import { describe, expect, it } from 'vitest';
import { parseSiteappApplicationCreate } from '../../shared/siteapp-cli-payload';
import { buildSiteAppCreateParams } from '../../electron/utils/siteapp-cli';

describe('siteapp application create params', () => {
  it('defaults page_type to site', () => {
    expect(buildSiteAppCreateParams({ name: 'Demo' })).toEqual({
      name: 'Demo',
      page_type: 'site',
    });
  });

  it('passes assets page_type through', () => {
    expect(buildSiteAppCreateParams({
      name: 'Assets App',
      description: '托管应用',
      pageType: 'assets',
    })).toEqual({
      name: 'Assets App',
      description: '托管应用',
      page_type: 'assets',
    });
  });

  it('normalizes unknown pageType to site', () => {
    expect(buildSiteAppCreateParams({
      name: 'Demo',
      pageType: 'unknown' as 'site',
    }).page_type).toBe('site');
  });
});

describe('parseSiteappApplicationCreate', () => {
  it('reads page_type from snake_case create response', () => {
    expect(parseSiteappApplicationCreate({
      data: {
        result: {
          body: {
            data: {
              app_code: 'app_test',
              name: 'Demo',
              page_type: 'assets',
            },
          },
        },
      },
    })).toMatchObject({
      appCode: 'app_test',
      name: 'Demo',
      pageType: 'assets',
    });
  });

  it('omits pageType when the create response does not include it', () => {
    expect(parseSiteappApplicationCreate({
      data: {
        result: {
          body: {
            data: { app_code: 'app_test' },
          },
        },
      },
    })).toEqual({
      appCode: 'app_test',
      name: undefined,
      status: undefined,
    });
  });
});
