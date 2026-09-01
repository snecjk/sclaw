import { describe, expect, it } from 'vitest';
import { resolvePublishSuccessPresentation } from '../../shared/code-publish-result';

describe('resolvePublishSuccessPresentation', () => {
  it('returns only the fixed URL for a site', () => {
    expect(resolvePublishSuccessPresentation({
      pageType: 'site',
      resourcePages: [{ url: 'https://fixed.example.cn', artifactUrl: 'https://oss.example.cn/site.zip' }],
    })).toEqual({ pageType: 'site', fixedUrl: 'https://fixed.example.cn' });
  });

  it('returns version and OSS artifact for assets', () => {
    expect(resolvePublishSuccessPresentation({
      pageType: 'assets',
      deploymentVersion: '1.4.0',
      resourcePages: [{ artifactUrl: 'https://oss.example.cn/assets/1.4.0/index.js' }],
    })).toEqual({
      pageType: 'assets',
      version: '1.4.0',
      artifactUrl: 'https://oss.example.cn/assets/1.4.0/index.js',
    });
  });

  it('accepts a direct resource URL string', () => {
    expect(resolvePublishSuccessPresentation({
      pageType: 'assets',
      revisionId: 'rev-12',
      resourcePages: 'https://oss.example.cn/assets/rev-12/',
    })).toEqual({
      pageType: 'assets',
      version: 'rev-12',
      artifactUrl: 'https://oss.example.cn/assets/rev-12/',
    });
  });

  it('does not reinterpret an OSS URL as a site fixed URL', () => {
    expect(resolvePublishSuccessPresentation({
      pageType: 'site',
      resourcePages: [{ artifactUrl: 'https://oss.example.cn/private/site.zip' }],
    })).toEqual({ pageType: 'site', fixedUrl: undefined });
  });
});
