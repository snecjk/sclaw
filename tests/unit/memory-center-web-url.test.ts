import { afterEach, describe, expect, it } from 'vitest';
import {
  buildMemoryCenterDesignerRedirectPath,
  buildMemoryCenterSsoCallbackUrl,
  buildMemoryCenterWorkflowDesignerEmbedUrl,
  buildMemoryCenterWorkflowDesignerUrl,
  buildMemoryCenterWorkflowNewUrl,
  getMemoryCenterWebBase,
  isMcWebAuthedInSession,
  markMcWebAuthedInSession,
  MC_WEB_TEST_BASE,
} from '@/lib/memory-center-web-url';

describe('memory-center-web-url', () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it('builds production designer url', () => {
    expect(buildMemoryCenterWorkflowDesignerUrl('wf_cb71ab7f', 'production-external')).toBe(
      'https://front.sto.cn/group/memory-center-web/workflows-workbench/wf_cb71ab7f?embedded=stoclaw&inClaw=1',
    );
  });

  it('builds test env designer url', () => {
    expect(buildMemoryCenterWorkflowDesignerUrl('wf_123', 'daily-external')).toBe(
      'https://front-test.sto.cn/group/memory-center-web/workflows-workbench/wf_123?embedded=stoclaw&inClaw=1',
    );
  });

  it('local sso defaults to test mc web', () => {
    expect(getMemoryCenterWebBase('local')).toBe(MC_WEB_TEST_BASE);
    expect(buildMemoryCenterWorkflowDesignerUrl('wf_abc', 'local')).toBe(
      `${MC_WEB_TEST_BASE}/workflows-workbench/wf_abc?embedded=stoclaw&inClaw=1`,
    );
  });

  it('builds new workflow url with templateId', () => {
    expect(buildMemoryCenterWorkflowNewUrl({ templateId: 'tpl_1' }, 'daily-external')).toBe(
      'https://front-test.sto.cn/group/memory-center-web/workflows-workbench/new?templateId=tpl_1&embedded=stoclaw&inClaw=1',
    );
  });

  it('builds sso callback url with redirect', () => {
    const redirect = buildMemoryCenterDesignerRedirectPath('wf_123', 'daily-external');
    expect(redirect).toBe(
      '/group/memory-center-web/workflows-workbench/wf_123?embedded=stoclaw&inClaw=1',
    );
    expect(
      buildMemoryCenterSsoCallbackUrl('tok-abc', {
        redirectPath: redirect,
        ssoEnvironment: 'daily-external',
      }),
    ).toBe(
      'https://front-test.sto.cn/group/memory-center-web/sso/login/callback?stoToken=tok-abc&redirect=%2Fgroup%2Fmemory-center-web%2Fworkflows-workbench%2Fwf_123%3Fembedded%3Dstoclaw%26inClaw%3D1&embedded=stoclaw',
    );
  });

  it('uses callback on first embed and direct url after session auth', () => {
    expect(buildMemoryCenterWorkflowDesignerEmbedUrl('wf_123', 'tok-abc', 'daily-external')).toContain(
      '/sso/login/callback?',
    );

    markMcWebAuthedInSession();
    expect(isMcWebAuthedInSession()).toBe(true);
    expect(buildMemoryCenterWorkflowDesignerEmbedUrl('wf_123', 'tok-abc', 'daily-external')).toBe(
      'https://front-test.sto.cn/group/memory-center-web/workflows-workbench/wf_123?embedded=stoclaw&inClaw=1',
    );
  });
});
