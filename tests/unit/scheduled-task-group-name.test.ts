import { describe, expect, it } from 'vitest';
import {
  buildScheduledTaskGroupDisplayName,
  looksLikeTechnicalTaskGroupLabel,
  resolveCronGroupNameFromSession,
  resolveStoScheduledGroupNameFromSession,
  sortScheduledTaskGroupsByFirstTriggerDesc,
} from '@/lib/scheduled-task-group-name';

describe('scheduled-task-group-name', () => {
  it('treats session keys and UUIDs as technical labels', () => {
    const key = 'agent:main:cron:abc-123:2026-06-25';
    expect(looksLikeTechnicalTaskGroupLabel(key, key)).toBe(true);
    expect(looksLikeTechnicalTaskGroupLabel('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true);
    expect(looksLikeTechnicalTaskGroupLabel('测试')).toBe(false);
  });

  it('extracts STO task name from dated agent label', () => {
    expect(resolveStoScheduledGroupNameFromSession({
      key: 'agent:main:scheduled-task:42:2026-06-25',
      label: '周会材料 - 2026-06-25',
    })).toBe('周会材料');
  });

  it('prefers displayName over cron UUID label', () => {
    expect(resolveCronGroupNameFromSession({
      key: 'agent:main:cron:job-uuid:2026-06-25',
      label: 'Cron: job-uuid',
      displayName: '测试',
    })).toBe('测试');
  });

  it('buildScheduledTaskGroupDisplayName uses task definition map', () => {
    const name = buildScheduledTaskGroupDisplayName(
      'cron',
      'job-uuid',
      [{
        key: 'agent:main:cron:job-uuid:2026-06-25',
        label: 'agent:main:cron:job-uuid:2026-06-25',
      }],
      {
        cron: new Map([['job-uuid', '日报生成']]),
        sto: new Map(),
        claude: new Map(),
      },
    );
    expect(name).toBe('日报生成');
  });

  it('sortScheduledTaskGroupsByFirstTriggerDesc orders by earliest session activity', () => {
    const sessionLastActivity: Record<string, number> = {};
    const groups = [
      {
        key: 'cron:older',
        name: '优美的问候语',
        sessions: [{ key: 'agent:main:cron:older:2026-06-20', updatedAt: Date.parse('2026-06-20') }],
      },
      {
        key: 'cron:newer',
        name: '测试',
        sessions: [{ key: 'agent:main:cron:newer:2026-06-25', updatedAt: Date.parse('2026-06-25') }],
      },
    ];
    const sorted = sortScheduledTaskGroupsByFirstTriggerDesc(groups, sessionLastActivity);
    expect(sorted.map((g) => g.name)).toEqual(['测试', '优美的问候语']);
  });

  it('same calendar day: orders by millisecond trigger time', () => {
    const day = '2026-06-25';
    const morning = new Date(2026, 5, 25, 9, 0, 0).getTime();
    const afternoon = new Date(2026, 5, 25, 15, 0, 0).getTime();
    const groups = [
      {
        key: 'cron:a',
        name: '优美的问候语',
        sessions: [{ key: `agent:main:cron:a:${day}`, updatedAt: morning }],
      },
      {
        key: 'cron:b',
        name: '测试',
        sessions: [{ key: `agent:main:cron:b:${day}`, updatedAt: afternoon }],
      },
    ];
    const sorted = sortScheduledTaskGroupsByFirstTriggerDesc(groups, {});
    expect(sorted.map((g) => g.name)).toEqual(['测试', '优美的问候语']);
  });

  it('same millisecond: tie-break by stable task id, not display name', () => {
    const ts = new Date(2026, 5, 25, 9, 0, 0, 500).getTime();
    const groups = [
      {
        key: 'cron:job-b',
        name: '优美的问候语',
        sessions: [{ key: 'agent:main:cron:job-b:2026-06-25', updatedAt: ts }],
      },
      {
        key: 'cron:job-a',
        name: '测试',
        sessions: [{ key: 'agent:main:cron:job-a:2026-06-25', updatedAt: ts }],
      },
    ];
    const sorted = sortScheduledTaskGroupsByFirstTriggerDesc(groups, {});
    expect(sorted.map((g) => g.key)).toEqual(['cron:job-a', 'cron:job-b']);
  });

  it('active runtime lifts group above start-of-day fallback when triggering today', () => {
    const afternoon = new Date(2026, 5, 25, 15, 0, 0).getTime();
    const nowMs = new Date(2026, 5, 25, 16, 30, 0).getTime();
    const day = '2026-06-25';
    const runningKey = `agent:main:cron:running:${day}`;
    const groups = [
      {
        key: 'cron:other',
        name: '优美的问候语',
        sessions: [{ key: `agent:main:cron:other:${day}`, updatedAt: afternoon }],
      },
      {
        key: 'cron:running',
        name: '测试',
        sessions: [{ key: runningKey }],
      },
    ];
    const sorted = sortScheduledTaskGroupsByFirstTriggerDesc(groups, {}, {
      runtimeBySessionKey: {
        [runningKey]: { sending: true, updatedAt: nowMs },
      },
      nowMs,
    });
    expect(sorted.map((g) => g.name)).toEqual(['测试', '优美的问候语']);
  });

  it('current scheduled session without recorded activity sorts as active', () => {
    const afternoon = new Date(2026, 5, 25, 15, 0, 0).getTime();
    const nowMs = new Date(2026, 5, 25, 16, 30, 0).getTime();
    const day = '2026-06-25';
    const runningKey = `agent:main:cron:running:${day}`;
    const groups = [
      {
        key: 'cron:other',
        name: '优美的问候语',
        sessions: [{ key: `agent:main:cron:other:${day}`, updatedAt: afternoon }],
      },
      {
        key: 'cron:running',
        name: '测试',
        sessions: [{ key: runningKey }],
      },
    ];
    const sorted = sortScheduledTaskGroupsByFirstTriggerDesc(groups, {}, {
      currentSessionKey: runningKey,
      nowMs,
    });
    expect(sorted.map((g) => g.name)).toEqual(['测试', '优美的问候语']);
  });

  it('activating session key sorts before loadSessions/switchSession race settles', () => {
    const afternoon = new Date(2026, 5, 25, 15, 0, 0).getTime();
    const activatingAt = new Date(2026, 5, 25, 16, 30, 0).getTime();
    const day = '2026-06-25';
    const runningKey = `agent:main:cron:running:${day}`;
    const groups = [
      {
        key: 'cron:other',
        name: '优美的问候语',
        sessions: [{ key: `agent:main:cron:other:${day}`, updatedAt: afternoon }],
      },
      {
        key: 'cron:running',
        name: '测试2号',
        sessions: [{ key: runningKey }],
      },
    ];
    const sorted = sortScheduledTaskGroupsByFirstTriggerDesc(groups, {}, {
      activatingScheduledSessionAt: { [runningKey]: activatingAt },
    });
    expect(sorted.map((g) => g.name)).toEqual(['测试2号', '优美的问候语']);
  });

  it('active group with old history still sorts by latest active session', () => {
    const oldDay = '2026-06-10';
    const today = '2026-06-25';
    const activatingAt = new Date(2026, 5, 25, 16, 30, 0).getTime();
    const groups = [
      {
        key: 'cron:running',
        name: '测试2号',
        sessions: [
          { key: `agent:main:cron:running:${oldDay}`, updatedAt: Date.parse(oldDay) },
          { key: `agent:main:cron:running:${today}` },
        ],
      },
      {
        key: 'cron:other',
        name: '优美的问候语',
        sessions: [{ key: `agent:main:cron:other:${today}`, updatedAt: activatingAt - 1000 }],
      },
    ];
    const sorted = sortScheduledTaskGroupsByFirstTriggerDesc(groups, {}, {
      activatingScheduledSessionAt: { [`agent:main:cron:running:${today}`]: activatingAt },
    });
    expect(sorted.map((g) => g.name)).toEqual(['测试2号', '优美的问候语']);
  });
});
