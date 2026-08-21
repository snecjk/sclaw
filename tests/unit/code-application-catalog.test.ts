import { describe, expect, it } from 'vitest';
import {
  applicationCodeFromName,
  normalizeCodeApplication,
  normalizeCodeApplicationPageType,
  parseCodeApplicationDetail,
  parseCodeApplicationList,
  parsePolicyApiError,
} from '../../shared/code-application-catalog';

describe('code application pageType', () => {
  it.each([
    ['site', 'site'],
    ['assets', 'assets'],
    [undefined, 'site'],
    ['unknown', 'site'],
  ])('normalizes %j to %s', (raw, expected) => {
    expect(normalizeCodeApplicationPageType(raw)).toBe(expected);
  });

  it('keeps pageType from a cloud application record', () => {
    expect(normalizeCodeApplication({
      applicationId: 'app-assets',
      applicationName: 'Assets App',
      pageType: 'assets',
    })).toMatchObject({ pageType: 'assets' });
  });
});

describe('parseCodeApplicationList', () => {
  it('reads applicationId and applicationName from data array', () => {
    const apps = parseCodeApplicationList({
      success: true,
      data: [
        {
          applicationId: 'app-1',
          applicationName: '示例应用',
          status: 'ACTIVE',
          createdAt: '2026-08-11T00:00:00.000Z',
          headRevisionId: 'rev-1',
          headCommitSha: 'abc123',
        },
      ],
    });
    expect(apps).toEqual([
      {
        applicationId: 'app-1',
        applicationName: '示例应用',
        status: 'ACTIVE',
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: undefined,
        headRevisionId: 'rev-1',
        headCommitSha: 'abc123',
        applicationUid: undefined,
        applicationCode: undefined,
        sourceSha256: undefined,
        description: undefined,
        previewUrl: undefined,
        developmentBranch: undefined,
        gitlabProjectId: undefined,
        devopsApplicationId: undefined,
        pageType: 'site',
      },
    ]);
  });

  it('keeps numeric gitlabProjectId and devopsApplicationId', () => {
    const apps = parseCodeApplicationList({
      data: [
        {
          applicationId: 'app-1',
          applicationName: '示例应用',
          gitlabProjectId: 7772,
          devopsApplicationId: 800220669,
        },
      ],
    });
    expect(apps[0]?.gitlabProjectId).toBe('7772');
    expect(apps[0]?.devopsApplicationId).toBe('800220669');
  });

  it('skips rows without applicationId', () => {
    const apps = parseCodeApplicationList({
      data: [{ applicationName: 'no-id' }, { applicationId: 'app-2', applicationName: 'ok' }],
    });
    expect(apps.map((app) => app.applicationId)).toEqual(['app-2']);
  });
});

describe('parsePolicyApiError', () => {
  it('prefers errMessage', () => {
    expect(parsePolicyApiError({ errMessage: '无权限' }, 'fallback')).toBe('无权限');
  });

  it('falls back to errorMsg', () => {
    expect(parsePolicyApiError({ errorMsg: '创建失败' }, 'fallback')).toBe('创建失败');
  });
});

describe('parseCodeApplicationDetail', () => {
  it('reads nested data object', () => {
    expect(parseCodeApplicationDetail({
      success: true,
      data: {
        applicationId: 'app-1',
        applicationName: 'demo',
        applicationUid: '01Kabc',
        applicationCode: 'demo',
        status: 'ACTIVE',
      },
    })).toMatchObject({
      applicationId: 'app-1',
      applicationUid: '01Kabc',
      status: 'ACTIVE',
    });
  });
});

describe('applicationCodeFromName', () => {
  it('normalizes application name to code', () => {
    expect(applicationCodeFromName('Test App 0811')).toBe('test-app-0811');
  });

  it('returns empty for names without latin/digit characters', () => {
    expect(applicationCodeFromName('测试应用')).toBe('');
  });
});
