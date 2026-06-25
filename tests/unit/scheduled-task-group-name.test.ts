import { describe, expect, it } from 'vitest';
import {
  buildScheduledTaskGroupDisplayName,
  looksLikeTechnicalTaskGroupLabel,
  resolveCronGroupNameFromSession,
  resolveStoScheduledGroupNameFromSession,
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
});
