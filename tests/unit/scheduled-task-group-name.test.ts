import { describe, expect, it } from 'vitest';
import {
  buildScheduledTaskGroupDisplayName,
  getSessionActivityMs,
  getSessionFirstTriggerMs,
  deriveGroupFirstTriggeredFromSessions,
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

  it('treats agent brand names as non-human task group titles', () => {
    expect(looksLikeTechnicalTaskGroupLabel('SClaw')).toBe(true);
    expect(looksLikeTechnicalTaskGroupLabel('StoClaw')).toBe(true);
    expect(looksLikeTechnicalTaskGroupLabel('sclaw')).toBe(true);
  });

  it('skips agent brand displayName and uses catalog/session label', () => {
    expect(resolveCronGroupNameFromSession({
      key: 'agent:main:cron:job-uuid:2026-06-25',
      label: '日报生成',
      displayName: 'SClaw',
    })).toBe('日报生成');
  });

  it('buildScheduledTaskGroupDisplayName ignores SClaw when nameMaps are empty', () => {
    const name = buildScheduledTaskGroupDisplayName(
      'cron',
      'job-uuid',
      [{
        key: 'agent:main:cron:job-uuid:2026-06-25',
        label: '日报生成',
        displayName: 'SClaw',
      }],
      { cron: new Map(), sto: new Map(), claude: new Map(), pi: new Map() },
    );
    expect(name).toBe('日报生成');
  });

  it('buildScheduledTaskGroupDisplayName falls back when only agent brand is available', () => {
    const name = buildScheduledTaskGroupDisplayName(
      'cron',
      'job-uuid',
      [{
        key: 'agent:main:cron:job-uuid:2026-06-25',
        displayName: 'SClaw',
        label: 'SClaw',
      }],
      { cron: new Map(), sto: new Map(), claude: new Map(), pi: new Map() },
    );
    expect(name).toBe('定时任务 job-uuid');
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
        pi: new Map(),
      },
    );
    expect(name).toBe('日报生成');
  });

  it('buildScheduledTaskGroupDisplayName uses the PI task definition map', () => {
    const name = buildScheduledTaskGroupDisplayName(
      'pi',
      'task-pi',
      [{ key: 'pi-task:task-pi:2026-09-03', label: 'pi-task:task-pi:2026-09-03' }],
      {
        cron: new Map(),
        sto: new Map(),
        claude: new Map(),
        pi: new Map([['task-pi', 'GitHub 热门项目']]),
      },
    );
    expect(name).toBe('GitHub 热门项目');
  });

  it('prefers refreshed nameMaps over stale catalog/session title after rename', () => {
    const sessions = [{
      key: 'agent:main:cron:job-uuid:2026-06-25',
      label: '旧任务名',
      displayName: '旧任务名',
    }];
    const staleMaps = {
      cron: new Map([['job-uuid', '旧任务名']]),
      sto: new Map<number, string>(),
      claude: new Map<string, string>(),
      pi: new Map<string, string>(),
    };
    const refreshedMaps = {
      cron: new Map([['job-uuid', '新任务名']]),
      sto: new Map<number, string>(),
      claude: new Map<string, string>(),
      pi: new Map<string, string>(),
    };
    expect(buildScheduledTaskGroupDisplayName('cron', 'job-uuid', sessions, staleMaps)).toBe('旧任务名');
    expect(buildScheduledTaskGroupDisplayName('cron', 'job-uuid', sessions, refreshedMaps)).toBe('新任务名');
  });

  it('buildScheduledTaskGroupDisplayName keeps user names that start with 定时任务', () => {
    const name = buildScheduledTaskGroupDisplayName(
      'cron',
      'job-uuid',
      [],
      {
        cron: new Map([['job-uuid', '定时任务测试']]),
        sto: new Map(),
        claude: new Map(),
        pi: new Map(),
      },
    );
    expect(name).toBe('定时任务测试');
  });

  it('getSessionActivityMs uses max of store and meta for recent order', () => {
    const key = 'agent:main:cron:job:2026-06-25';
    const older = Date.parse('2026-06-25T08:00:00');
    const newer = Date.parse('2026-06-25T18:00:00');
    expect(getSessionActivityMs(
      { key, updatedAt: older },
      { [key]: newer },
    )).toBe(newer);
  });

  it('getSessionFirstTriggerMs still uses min of store and meta', () => {
    const key = 'agent:main:cron:job:2026-06-25';
    const older = Date.parse('2026-06-25T08:00:00');
    const newer = Date.parse('2026-06-25T18:00:00');
    expect(getSessionFirstTriggerMs(
      { key, updatedAt: newer },
      { [key]: older },
    )).toBe(older);
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

  it('executing subitem does not lift group above groups with earlier first trigger', () => {
    const afternoon = new Date(2026, 5, 25, 15, 0, 0).getTime();
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
    const sorted = sortScheduledTaskGroupsByFirstTriggerDesc(groups, {});
    expect(sorted.map((g) => g.name)).toEqual(['优美的问候语', '测试']);
  });

  it('activating session key does not change group order', () => {
    const afternoon = new Date(2026, 5, 25, 15, 0, 0).getTime();
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
    const sorted = sortScheduledTaskGroupsByFirstTriggerDesc(groups, {});
    expect(sorted.map((g) => g.name)).toEqual(['优美的问候语', '测试2号']);
  });

  it('active group with old history sorts by earliest session (first trigger)', () => {
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
    const sorted = sortScheduledTaskGroupsByFirstTriggerDesc(groups, {});
    expect(sorted.map((g) => g.name)).toEqual(['优美的问候语', '测试2号']);
  });

  it('mixes builtin STO with cron by first trigger desc', () => {
    const groups = [
      {
        key: 'sto:hq-reconciliation',
        name: '周会材料生成',
        sessions: [{ key: 'agent:main:sto-hq-reconciliation-2026-06-20', updatedAt: Date.parse('2026-06-20') }],
      },
      {
        key: 'cron:newer',
        name: '测试',
        sessions: [{ key: 'agent:main:cron:newer:2026-06-25', updatedAt: Date.parse('2026-06-25') }],
      },
    ];
    const sorted = sortScheduledTaskGroupsByFirstTriggerDesc(groups, {});
    expect(sorted.map((g) => g.name)).toEqual(['测试', '周会材料生成']);
  });

  it('prefers persisted first-trigger when session fallback is start-of-day', () => {
    const day = '2026-06-25';
    const runningKey = `agent:main:cron:running:${day}`;
    const afternoon = new Date(2026, 5, 25, 15, 0, 0).getTime();
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
    const stored = { 'cron:running': new Date(2026, 5, 25, 16, 30, 0).getTime() };
    const sorted = sortScheduledTaskGroupsByFirstTriggerDesc(groups, {}, stored);
    expect(sorted.map((g) => g.name)).toEqual(['测试', '优美的问候语']);
  });

  it('deriveGroupFirstTriggeredFromSessions uses earliest subitem activity', () => {
    const sessions = [
      { key: 'agent:main:cron:a:2026-06-25', updatedAt: Date.parse('2026-06-25') },
      { key: 'agent:main:cron:a:2026-06-28', updatedAt: Date.parse('2026-06-28') },
    ];
    expect(deriveGroupFirstTriggeredFromSessions(sessions, {})).toBe(Date.parse('2026-06-25'));
  });

  it('stored first-trigger ignores remaining subitems after partial delete', () => {
    const dayOld = '2026-06-25';
    const dayNew = '2026-06-28';
    const stored = { 'cron:a': Date.parse(dayOld) };
    const groups = [
      {
        key: 'cron:a',
        name: '测试',
        sessions: [{ key: `agent:main:cron:a:${dayNew}`, updatedAt: Date.parse(dayNew) }],
      },
      {
        key: 'cron:b',
        name: '优美的问候语',
        sessions: [{ key: 'agent:main:cron:b:2026-06-26', updatedAt: Date.parse('2026-06-26') }],
      },
    ];
    const sorted = sortScheduledTaskGroupsByFirstTriggerDesc(groups, {}, stored);
    expect(sorted.map((g) => g.name)).toEqual(['优美的问候语', '测试']);
  });
});
