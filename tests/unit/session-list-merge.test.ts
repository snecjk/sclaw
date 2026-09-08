import { describe, expect, it } from 'vitest';
import {
  appendPendingLocalVirtualTaskSessions,
  filterTaskSidebarCatalogRows,
  mergeEngineAndCatalogScheduledTaskSessions,
  omitSupersededCronDatedAgentTwins,
  preferCatalogTaskTitle,
  resolveCatalogRowTaskName,
  resolveTaskSidebarRowTitles,
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

  it('keeps pending local PI task sessions until catalog materializes them', () => {
    const key = 'pi-task:task-pi:2026-09-03';
    const merged = appendPendingLocalVirtualTaskSessions(
      [],
      [{ key, displayName: 'PI 日报' }],
      new Set(),
    );
    expect(merged).toEqual([{ key, displayName: 'PI 日报' }]);
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

  it('fills catalog-only dated PI task placeholders with the PI engine', () => {
    const merged = mergeEngineAndCatalogScheduledTaskSessions(
      [],
      [{
        sessionKey: 'pi-task:task-pi:2026-09-03',
        sessionType: 'scheduled_task',
        taskId: 'task-pi',
        title: 'GitHub 热门项目',
        lastActivityAt: '2026-09-03T02:00:00.000Z',
      }],
    );
    expect(merged).toEqual([expect.objectContaining({
      key: 'pi-task:task-pi:2026-09-03',
      displayName: 'GitHub 热门项目',
      engineType: 'pi',
    })]);
  });

  it('only accepts supported dated task keys and drops summary/run/base history', () => {
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

  it('keeps dated rows without a human title (visibility is decided by the render layer)', () => {
    // 无标题可能来自迁移/绑定路径的存量真实会话，store 层滤掉会让其彻底不可达；
    // 空壳判定下沉到渲染层（catalog 标题 → 引擎 label → 任务定义名回落）。
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
      'agent:main:cron:job-1:2026-08-07',
      'agent:main:cron:job-1:2026-08-08',
      'agent:main:cron:job-1:2026-08-06',
    ]);
  });

  it('keeps dated PI task rows and drops PI base rows', () => {
    const filtered = filterTaskSidebarCatalogRows([
      {
        sessionKey: 'pi-task:task-pi',
        sessionType: 'scheduled_task',
        taskId: 'task-pi',
        title: 'base',
        lastActivityAt: null,
      },
      {
        sessionKey: 'pi-task:task-pi:2026-09-03',
        sessionType: 'scheduled_task',
        taskId: 'task-pi',
        title: 'GitHub 热门项目',
        lastActivityAt: '2026-09-03T02:00:00.000Z',
      },
    ]);
    expect(filtered.map((row) => row.sessionKey)).toEqual([
      'pi-task:task-pi:2026-09-03',
    ]);
  });
});

describe('resolveTaskSidebarRowTitles', () => {
  it('prefers the catalog title over engine values and the task name', () => {
    expect(resolveTaskSidebarRowTitles({
      catalogTitle: '日报',
      engineLabel: 'SClaw',
      engineDisplayName: 'SClaw',
      taskName: '任务定义名',
    })).toEqual({ label: '日报', displayName: '日报' });
  });

  it('falls back to human engine values when the catalog title is missing or technical', () => {
    expect(resolveTaskSidebarRowTitles({
      catalogTitle: null,
      engineLabel: '引擎标签',
      engineDisplayName: '引擎显示名',
      taskName: '任务定义名',
    })).toEqual({ label: '引擎标签', displayName: '引擎显示名' });
    expect(resolveTaskSidebarRowTitles({
      catalogTitle: 'SClaw',
      engineLabel: '引擎标签',
    })).toEqual({ label: '引擎标签', displayName: undefined });
  });

  it('falls back to the task definition name when catalog and engine have no human title', () => {
    expect(resolveTaskSidebarRowTitles({
      catalogTitle: null,
      engineLabel: 'SClaw',
      engineDisplayName: undefined,
      taskName: '客户成本分析',
    })).toEqual({ label: '客户成本分析', displayName: '客户成本分析' });
  });

  it('keeps a user-chosen task name even when it matches the agent brand', () => {
    expect(resolveTaskSidebarRowTitles({
      catalogTitle: null,
      engineLabel: 'SClaw',
      engineDisplayName: 'SClaw',
      taskName: 'SClaw',
    })).toEqual({ label: 'SClaw', displayName: 'SClaw' });
  });

  it('returns undefined for true empty shells (no human title anywhere)', () => {
    expect(resolveTaskSidebarRowTitles({
      catalogTitle: null,
      engineLabel: 'SClaw',
      engineDisplayName: undefined,
      taskName: undefined,
    })).toBeUndefined();
    expect(resolveTaskSidebarRowTitles({
      catalogTitle: 'SClaw',
      engineLabel: 'SClaw',
      engineDisplayName: 'StoClaw',
      taskName: undefined,
    })).toBeUndefined();
  });
});

describe('resolveCatalogRowTaskName', () => {
  const nameMaps = {
    cron: new Map([['job-1', '日报任务']]),
    claude: new Map([['t1', '周报任务']]),
    pi: new Map([['task-pi', 'PI 日报任务']]),
  };

  it('resolves cron rows by taskId, falling back to the parsed jobId', () => {
    expect(resolveCatalogRowTaskName({
      sessionKey: 'agent:main:cron:job-1:2026-08-07',
      sessionType: 'cron',
      taskId: 'job-1',
    }, nameMaps)).toBe('日报任务');
    expect(resolveCatalogRowTaskName({
      sessionKey: 'agent:main:cron:job-1:2026-08-07',
      sessionType: 'cron',
      taskId: null,
    }, nameMaps)).toBe('日报任务');
  });

  it('resolves claude_task rows by taskId and returns undefined for unknown tasks', () => {
    expect(resolveCatalogRowTaskName({
      sessionKey: 'claude-task:t1:2026-08-07',
      sessionType: 'claude_task',
      taskId: 't1',
    }, nameMaps)).toBe('周报任务');
    expect(resolveCatalogRowTaskName({
      sessionKey: 'claude-task:unknown:2026-08-07',
      sessionType: 'claude_task',
      taskId: 'unknown',
    }, nameMaps)).toBeUndefined();
  });

  it('resolves PI scheduled_task rows from the unified task definition map', () => {
    expect(resolveCatalogRowTaskName({
      sessionKey: 'pi-task:task-pi:2026-09-03',
      sessionType: 'scheduled_task',
      taskId: null,
    }, nameMaps)).toBe('PI 日报任务');
  });
});
