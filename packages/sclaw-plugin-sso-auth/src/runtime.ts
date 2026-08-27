import { bootstrapSsoAuth } from './index';
import { StoSsoAuthError } from './errors';
import type { SclawFrontendPlugin } from './types';

const plugin: SclawFrontendPlugin = {
  id: 'sto.sso-auth',
  pageTypes: ['site'],
  async activate(context) {
    if (context.pageType !== 'site') {
      throw new StoSsoAuthError(
        'SSO_AUTH_PAGE_TYPE_UNSUPPORTED',
        'SSO Auth 插件不能在 Assets 应用中启动',
      );
    }
    const auth = await bootstrapSsoAuth();
    context.provide('auth.sto-token', auth);
  },
};

export default plugin;
