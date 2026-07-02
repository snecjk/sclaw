import { describe, expect, it } from 'vitest';
import { appendPendingLocalVirtualTaskSessions } from '@/stores/chat/session-list-merge';

describe('appendPendingLocalVirtualTaskSessions', () => {
  it('keeps local virtual cron sessions missing from remote after switching away', () => {
    const remote = [{ key: 'agent:main:cron:other-job:2026-06-20' }];
    const local = [
      { key: 'agent:main:cron:other-job:2026-06-20' },
      { key: 'agent:main:cron:new-job:2026-06-28', displayName: '新任务' },
    ];
    const merged = appendPendingLocalVirtualTaskSessions(remote, local, new Set());
    expect(merged).toHaveLength(2);
    expect(merged.map((s) => s.key)).toContain('agent:main:cron:new-job:2026-06-28');
  });

  it('does not revive user-deleted virtual sessions', () => {
    const remote: Array<{ key: string }> = [];
    const local = [{ key: 'agent:main:cron:deleted:2026-06-28' }];
    const deleted = new Set(['agent:main:cron:deleted:2026-06-28']);
    const merged = appendPendingLocalVirtualTaskSessions(remote, local, deleted);
    expect(merged).toHaveLength(0);
  });

  it('does not duplicate sessions already present remotely', () => {
    const key = 'claude-task:task-1:2026-06-28';
    const remote = [{ key, displayName: '远程' }];
    const local = [{ key, displayName: '本地' }];
    const merged = appendPendingLocalVirtualTaskSessions(remote, local, new Set());
    expect(merged).toHaveLength(1);
    expect(merged[0]?.displayName).toBe('远程');
  });
});
