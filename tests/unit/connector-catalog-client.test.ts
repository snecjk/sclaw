import { beforeEach, describe, expect, it, vi } from 'vitest';

const memoryCenterFetchForSessionMock = vi.fn();

vi.mock('@electron/services/sto-memory-api-fetch', () => ({
  memoryCenterFetchForSession: (...args: unknown[]) => memoryCenterFetchForSessionMock(...args),
  StoMemoryApiError: class StoMemoryApiError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

import { fetchConnectorCatalog } from '@electron/connectors/catalog-client';

describe('connector catalog client', () => {
  beforeEach(() => memoryCenterFetchForSessionMock.mockReset());

  it('uses the authorized standalone connector catalog endpoint', async () => {
    memoryCenterFetchForSessionMock.mockResolvedValue({ success: true, data: [] });

    await expect(fetchConnectorCatalog()).resolves.toEqual([]);
    expect(memoryCenterFetchForSessionMock).toHaveBeenCalledWith('/agent/v1/connectors', {
      method: 'POST',
    });
  });
});
