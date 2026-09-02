import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

import {
  applyAppTemplateImport,
  cancelAppTemplateImport,
  getAppTemplateImportStatus,
  prepareAppTemplateImport,
} from '@/lib/app-dev-api';

describe('app template source import renderer API', () => {
  beforeEach(() => hostApiFetchMock.mockReset());

  it('uses the four workspace source import endpoints', async () => {
    hostApiFetchMock.mockResolvedValue({});

    await getAppTemplateImportStatus('ws-1');
    await prepareAppTemplateImport({ workspaceId: 'ws-1', sourcePath: '/source/demo' });
    await applyAppTemplateImport({ workspaceId: 'ws-1', importToken: 'token-1' });
    await cancelAppTemplateImport({ workspaceId: 'ws-1', importToken: 'token-1' });

    expect(hostApiFetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/app-templates/workspaces/import-source/status?workspaceId=ws-1',
    );
    expect(hostApiFetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/app-templates/workspaces/import-source/prepare',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ workspaceId: 'ws-1', sourcePath: '/source/demo' }),
      }),
    );
    expect(hostApiFetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/app-templates/workspaces/import-source/apply',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ workspaceId: 'ws-1', importToken: 'token-1' }),
      }),
    );
    expect(hostApiFetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/app-templates/workspaces/import-source/cancel',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ workspaceId: 'ws-1', importToken: 'token-1' }),
      }),
    );
  });
});
