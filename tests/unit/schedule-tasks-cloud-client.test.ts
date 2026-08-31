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

import { listScheduleTasksCloud } from '@electron/scheduled-tasks/schedule-tasks-cloud-client';
import { StoMemoryApiError } from '@electron/services/sto-memory-api-fetch';

describe('listScheduleTasksCloud envelope', () => {
  beforeEach(() => memoryCenterFetchForSessionMock.mockReset());

  it('accepts wrapped empty items as a true empty cloud', async () => {
    memoryCenterFetchForSessionMock.mockResolvedValue({
      success: true,
      data: { items: [] },
      total: 0,
    });
    await expect(listScheduleTasksCloud(true)).resolves.toEqual([]);
  });

  it('accepts data as an array', async () => {
    memoryCenterFetchForSessionMock.mockResolvedValue({
      success: true,
      data: [{ id: 't1', version: 1 }],
    });
    await expect(listScheduleTasksCloud(true)).resolves.toEqual([{ id: 't1', version: 1 }]);
  });

  it.each([
    { success: true },
    { success: true, data: {} },
    { success: true, data: null },
    null,
  ])('throws on malformed envelope %j so push will not bootstrap', async (payload) => {
    memoryCenterFetchForSessionMock.mockResolvedValue(payload);
    await expect(listScheduleTasksCloud(true)).rejects.toBeInstanceOf(StoMemoryApiError);
  });
});
