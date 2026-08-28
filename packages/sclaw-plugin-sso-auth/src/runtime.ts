import { bootstrapSsoAuth } from './index';
import type { SclawFrontendPlugin } from './types';

const plugin: SclawFrontendPlugin = {
  id: 'sto.sso-auth',
  pageTypes: ['site', 'assets'],
  async activate(context) {
    const auth = await bootstrapSsoAuth();
    context.provide('auth.sto-token', auth);
  },
};

export default plugin;
