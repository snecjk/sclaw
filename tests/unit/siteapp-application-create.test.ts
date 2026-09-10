import { describe, expect, it } from 'vitest';
import { parseSiteappApplicationCreate, parseSiteappRevision, parseSiteappSavedFiles } from '../../shared/siteapp-cli-payload';
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

describe('parseSiteappRevision', () => {
  it('reads file_count from HTTP source commit payload', () => {
    expect(parseSiteappRevision({
      success: true,
      data: {
        app_code: 'app_test',
        revision_id: '01J00000000000000000000000',
        status: 'ready',
        commit_sha: 'abc',
        source_sha256: 'aa',
        archive_sha256: 'bb',
        file_count: 4,
      },
    })).toMatchObject({
      appCode: 'app_test',
      revisionId: '01J00000000000000000000000',
      status: 'ready',
      commitSha: 'abc',
      fileCount: 4,
    });
  });
});

describe('parseSiteappSavedFiles', () => {
  it('reads savedFiles from sai-cli source download payload (result.savedFiles)', () => {
    expect(parseSiteappSavedFiles({
      input: { app_code: 'app_cb1bddf371e19a70' },
      path: 'siteapp.source.download',
      result: {
        savedFiles: [{
          contentType: 'application/gzip',
          fileName: 'app_cb1bddf371e19a70-dev.tar.gz',
          localPath: 'file:///Users/sto/.sai/out/siteapp/source/download/app_cb1bddf371e19a70-dev.tar.gz',
          size: 254,
        }],
        statusCode: 200,
      },
    })).toEqual([{
      localPath: 'file:///Users/sto/.sai/out/siteapp/source/download/app_cb1bddf371e19a70-dev.tar.gz',
      fileName: 'app_cb1bddf371e19a70-dev.tar.gz',
      size: 254,
      contentType: 'application/gzip',
    }]);
  });

  it('still reads nested data.result.savedFiles', () => {
    expect(parseSiteappSavedFiles({
      data: {
        result: {
          savedFiles: [{ localPath: '/tmp/source.tar.gz', fileName: 'source.tar.gz' }],
        },
      },
    })).toEqual([{
      localPath: '/tmp/source.tar.gz',
      fileName: 'source.tar.gz',
      size: undefined,
      contentType: undefined,
    }]);
  });
});
