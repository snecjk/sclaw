import { beforeEach, describe, expect, it, vi } from 'vitest';

const memoryCenterFetchForSessionMock = vi.fn();

vi.mock('@electron/services/sto-memory-api-fetch', () => ({
  memoryCenterFetchForSession: (...args: unknown[]) => memoryCenterFetchForSessionMock(...args),
  memoryCenterFetchBinaryForSession: vi.fn(),
  StoMemoryApiError: class StoMemoryApiError extends Error {},
}));

import { syncSiteAppMenus } from '@electron/services/site-app-api';

describe('syncSiteAppMenus', () => {
  beforeEach(() => {
    memoryCenterFetchForSessionMock.mockReset();
    memoryCenterFetchForSessionMock.mockResolvedValue({ success: true, data: { replaced: 1 } });
  });

  it('posts to /api/v1/cli/site-app/menus/replace', async () => {
    const params = {
      app_code: 'app_test',
      menus: [{
        menu_code: 'home',
        parent_code: null,
        menu_name: '首页',
        menu_type: 'page',
      }],
    };

    await syncSiteAppMenus(params);

    expect(memoryCenterFetchForSessionMock).toHaveBeenCalledWith(
      '/api/v1/cli/site-app/menus/replace',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(params),
      }),
    );
  });
});
