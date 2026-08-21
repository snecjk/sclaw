import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn(),
}));

describe('cron store nameMapsRefreshKey', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('increments independently of catalog titles so sidebar can refetch task names', async () => {
    const { useCronStore } = await import('@/stores/cron');
    useCronStore.setState({ nameMapsRefreshKey: 0 });
    expect(useCronStore.getState().nameMapsRefreshKey).toBe(0);
    useCronStore.getState().bumpNameMapsRefreshKey();
    expect(useCronStore.getState().nameMapsRefreshKey).toBe(1);
    useCronStore.getState().bumpNameMapsRefreshKey();
    expect(useCronStore.getState().nameMapsRefreshKey).toBe(2);
  });
});
