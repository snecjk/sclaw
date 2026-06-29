import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn().mockResolvedValue({ keys: [] }),
}));

import { omitDeletedSessionKeys } from '@/lib/deleted-session-filter';

describe('deleted-session-filter', () => {
  it('omitDeletedSessionKeys removes keys in the deleted set', () => {
    const sessions = [
      { key: 'agent:main:cron:a:2026-06-25' },
      { key: 'agent:main:cron:b:2026-06-25' },
    ];
    const filtered = omitDeletedSessionKeys(
      sessions,
      new Set(['agent:main:cron:a:2026-06-25']),
    );
    expect(filtered.map((s) => s.key)).toEqual(['agent:main:cron:b:2026-06-25']);
  });

  it('omitDeletedSessionKeys suppresses related cron run sessions', () => {
    const ts = new Date(2026, 5, 25, 9, 0, 0).getTime();
    const filtered = omitDeletedSessionKeys(
      [{ key: 'agent:main:cron:job:run:xyz', updatedAt: ts }],
      new Set(['agent:main:cron:job:2026-06-25']),
    );
    expect(filtered).toHaveLength(0);
  });

  it('forgetOptimisticDeletedSessionKey clears renderer-side optimistic hide', async () => {
    const { rememberOptimisticDeletedSessionKey, forgetOptimisticDeletedSessionKey, fetchDeletedSessionKeys } = await import('@/lib/deleted-session-filter');
    rememberOptimisticDeletedSessionKey('agent:main:cron:a:2026-06-25');
    let keys = await fetchDeletedSessionKeys();
    expect(keys.has('agent:main:cron:a:2026-06-25')).toBe(true);
    forgetOptimisticDeletedSessionKey('agent:main:cron:a:2026-06-25');
    keys = await fetchDeletedSessionKeys();
    expect(keys.has('agent:main:cron:a:2026-06-25')).toBe(false);
  });
});
