import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { resolveIframeApplicationId } from '../../resources/app-templates/assets-iframe-analysis/src/sclaw/iframe-app-config';

describe('assets iframe analysis template', () => {
  it('prefers the published runtime application ID', () => {
    expect(resolveIframeApplicationId({
      runtimeConfig: { applicationId: 'app_runtime' },
      buildApplicationId: 'app_build',
    })).toBe('app_runtime');
  });

  it('falls back to the build-time application ID', () => {
    expect(resolveIframeApplicationId({ buildApplicationId: 'app_build' })).toBe('app_build');
  });

  it('explains how to configure a missing application ID', () => {
    expect(() => resolveIframeApplicationId({})).toThrow(
      '请配置 window.__SCLAW_APP_CONFIG__.applicationId 或 VITE_SCLAW_APPLICATION_ID',
    );
  });

  it('ships an install config that hoists UI-library transitive dependencies', () => {
    const npmrc = readFileSync(join(
      process.cwd(),
      'resources/app-templates/assets-iframe-analysis/.npmrc',
    ), 'utf8');

    expect(npmrc).toContain('shamefully-hoist=true');
  });
});
