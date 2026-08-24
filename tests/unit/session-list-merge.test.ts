import { describe, expect, it } from 'vitest';
import {
  appendPendingLocalVirtualTaskSessions,
  filterTaskSidebarCatalogRows,
  mergeEngineAndCatalogScheduledTaskSessions,
  omitSupersededCronDatedAgentTwins,
  preferCatalogTaskTitle,
} from '@/stores/chat/session-list-merge';

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

describe('omitSupersededCronDatedAgentTwins', () => {
  it('keeps non-main dated key when main twin also exists', () => {
    const sessions = [
      { key: 'agent:main:cron:job-1:2026-06-28' },
      { key: 'agent:ops:cron:job-1:2026-06-28' },
      { key: 'agent:main:cron:other:2026-06-28' },
    ];
    const filtered = omitSupersededCronDatedAgentTwins(sessions);
    expect(filtered.map((s) => s.key)).toEqual([
      'agent:ops:cron:job-1:2026-06-28',
      'agent:main:cron:other:2026-06-28',
    ]);
  });

  it('prefers the activating/current key when both agent twins exist', () => {
    const sessions = [
      { key: 'agent:main:cron:job-1:2026-06-28' },
      { key: 'agent:ops:cron:job-1:2026-06-28' },
    ];
    const filtered = omitSupersededCronDatedAgentTwins(
      sessions,
      'agent:main:cron:job-1:2026-06-28',
    );
    expect(filtered.map((s) => s.key)).toEqual([
      'agent:main:cron:job-1:2026-06-28',
    ]);
  });
});

describe('appendPendingLocalVirtualTaskSessions cron agent twins', () => {
  it('does not append local dated cron when remote already has same job+date under another agent', () => {
    const remote = [{ key: 'agent:main:cron:job-1:2026-06-28' }];
    const local = [
      { key: 'agent:main:cron:job-1:2026-06-28' },
      { key: 'agent:ops:cron:job-1:2026-06-28', displayName: '下班提醒' },
    ];
    const merged = appendPendingLocalVirtualTaskSessions(remote, local, new Set());
    expect(merged.map((s) => s.key)).toEqual(['agent:main:cron:job-1:2026-06-28']);
  });
});

describe('mergeEngineAndCatalogScheduledTaskSessions', () => {
  it('fills catalog-only dated cron placeholders missing from engine list', () => {
    const merged = mergeEngineAndCatalogScheduledTaskSessions(
      [{ key: 'agent:main:main' }],
      [{
        sessionKey: 'agent:main:cron:job-1:2026-07-24',
        sessionType: 'cron',
        taskId: 'job-1',
        title: '日报',
        lastActivityAt: '2026-07-24T01:00:00.000Z',
      }],
    );
    expect(merged.map((s) => s.key)).toEqual([
      'agent:main:cron:job-1:2026-07-24',
      'agent:main:main',
    ]);
    expect(merged[0]).toMatchObject({
      displayName: '日报',
      engineType: 'openclaw',
      updatedAt: Date.parse('2026-07-24T01:00:00.000Z'),
    });
  });

  it('keeps catalog title when engine displayName is the agent brand', () => {
    const merged = mergeEngineAndCatalogScheduledTaskSessions(
      [{
        key: 'agent:main:cron:job-1:2026-07-24',
        displayName: 'SClaw',
        label: 'SClaw',
      }],
      [{
        sessionKey: 'agent:main:cron:job-1:2026-07-24',
        sessionType: 'cron',
        taskId: 'job-1',
        title: '日报',
        lastActivityAt: '2026-07-24T01:00:00.000Z',
      }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      displayName: '日报',
      label: '日报',
    });
  });

  it('lets engine fields win but keeps catalog displayName when engine omits it', () => {
    const merged = mergeEngineAndCatalogScheduledTaskSessions(
      [{
        key: 'claude-task:t1:2026-07-24',
        updatedAt: 100,
        engineType: 'claude' as const,
        model: 'sonnet',
      }],
      [{
        sessionKey: 'claude-task:t1:2026-07-24',
        sessionType: 'claude_task',
        taskId: 't1',
        title: '周报',
        lastActivityAt: '2026-07-24T02:00:00.000Z',
      }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      key: 'claude-task:t1:2026-07-24',
      displayName: '周报',
      updatedAt: 100,
      engineType: 'claude',
      model: 'sonnet',
    });
  });

  it('only accepts dated session_type cron/claude_task; drops run/base/history', () => {
    const merged = mergeEngineAndCatalogScheduledTaskSessions(
      [],
      [
        {
          sessionKey: 'scheduled-task:42',
          sessionType: 'scheduled_task',
          taskId: '42',
          title: '云端旧任务',
          lastActivityAt: null,
        },
        {
          sessionKey: 'agent:main:cron:job-2',
          sessionType: 'cron',
          taskId: 'job-2',
          title: 'base',
          lastActivityAt: null,
        },
        {
          sessionKey: 'agent:main:cron:job-2:run:abc',
          sessionType: 'cron',
          taskId: 'job-2',
          title: 'run',
          lastActivityAt: '2026-07-24T15:00:00.000Z',
        },
        {
          sessionKey: 'agent:main:cron:job-2:2026-07-24',
          sessionType: 'cron',
          taskId: 'job-2',
          title: 'dated',
          lastActivityAt: '2026-07-24T16:00:00.000Z',
        },
      ],
    );
    expect(merged.map((s) => s.key)).toEqual(['agent:main:cron:job-2:2026-07-24']);
  });
});

describe('preferCatalogTaskTitle', () => {
  it('prefers catalog task title over engine agent brand', () => {
    expect(preferCatalogTaskTitle('日报', 'SClaw')).toBe('日报');
    expect(preferCatalogTaskTitle(' 周报 ', 'StoClaw')).toBe('周报');
  });

  it('falls back to a human engine label when catalog title is missing', () => {
    expect(preferCatalogTaskTitle(null, '周报')).toBe('周报');
    expect(preferCatalogTaskTitle('SClaw', '周报')).toBe('周报');
  });

  it('drops agent brand when neither side has a human title', () => {
    expect(preferCatalogTaskTitle('SClaw', 'SClaw')).toBeUndefined();
    expect(preferCatalogTaskTitle(null, 'SClaw')).toBeUndefined();
  });
});

describe('filterTaskSidebarCatalogRows', () => {
  it('keeps one dated row per task+day (latest activity)', () => {
    const filtered = filterTaskSidebarCatalogRows([
      {
        sessionKey: 'agent:main:cron:job-1:2026-07-24',
        sessionType: 'cron',
        taskId: 'job-1',
        title: '客户成本分析',
        lastActivityAt: '2026-07-24T10:00:00.000Z',
      },
      {
        sessionKey: 'agent:ops:cron:job-1:2026-07-24',
        sessionType: 'cron',
        taskId: 'job-1',
        title: '客户成本分析',
        lastActivityAt: '2026-07-24T12:00:00.000Z',
      },
      {
        sessionKey: 'agent:main:cron:job-1:run:x',
        sessionType: 'cron',
        taskId: 'job-1',
        title: '客户成本分析',
        lastActivityAt: '2026-07-24T13:00:00.000Z',
      },
    ]);
    expect(filtered.map((r) => r.sessionKey)).toEqual(['agent:ops:cron:job-1:2026-07-24']);
  });

  it('drops dated rows without a human title (empty shells / agent brand)', () => {
    const filtered = filterTaskSidebarCatalogRows([
      {
        sessionKey: 'agent:main:cron:job-1:2026-08-07',
        sessionType: 'cron',
        taskId: 'job-1',
        title: null,
        lastActivityAt: '2026-08-07T01:00:00.000Z',
      },
      {
        sessionKey: 'agent:main:cron:job-1:2026-08-08',
        sessionType: 'cron',
        taskId: 'job-1',
        title: 'SClaw',
        lastActivityAt: '2026-08-08T01:00:00.000Z',
      },
      {
        sessionKey: 'agent:main:cron:job-1:2026-08-06',
        sessionType: 'cron',
        taskId: 'job-1',
        title: '客户成本分析',
        lastActivityAt: '2026-08-06T01:00:00.000Z',
      },
    ]);
    expect(filtered.map((r) => r.sessionKey)).toEqual([
      'agent:main:cron:job-1:2026-08-06',
    ]);
  });
});
