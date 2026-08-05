import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getCachedDwsAuthenticated,
  getCachedDwsInstalled,
  invalidateDwsStatusCache,
} from '../../electron/utils/dws-status-cache';

describe('dws-status-cache', () => {
  afterEach(() => {
    invalidateDwsStatusCache();
  });

  it('caches installed probe until invalidate', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ installed: false })
      .mockResolvedValueOnce({ installed: true });

    const first = await getCachedDwsInstalled(fetcher);
    const second = await getCachedDwsInstalled(fetcher);
    expect(first).toEqual({ installed: false });
    expect(second).toEqual({ installed: false });
    expect(fetcher).toHaveBeenCalledTimes(1);

    invalidateDwsStatusCache();
    const third = await getCachedDwsInstalled(fetcher);
    expect(third).toEqual({ installed: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('caches auth probe until invalidate', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    expect(await getCachedDwsAuthenticated(fetcher)).toBe(false);
    expect(await getCachedDwsAuthenticated(fetcher)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);

    invalidateDwsStatusCache();
    expect(await getCachedDwsAuthenticated(fetcher)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
