import { describe, expect, it } from 'vitest';
import {
  isPiScheduledTaskDatedSessionKey,
  isVirtualTaskSessionKey,
  parsePiScheduledTaskSessionKey,
} from '@/stores/chat/cron-session-utils';

describe('isVirtualTaskSessionKey', () => {
  it('recognizes PI scheduled-task sessions as virtual sessions', () => {
    expect(isVirtualTaskSessionKey('pi-task:task-1:2026-09-03')).toBe(true);
    expect(parsePiScheduledTaskSessionKey('pi-task:task-1:2026-09-03')).toEqual({
      taskId: 'task-1',
      date: '2026-09-03',
    });
    expect(isPiScheduledTaskDatedSessionKey('pi-task:task-1:2026-09-03')).toBe(true);
  });

  it('continues to recognize OpenClaw and Claude scheduled-task sessions', () => {
    expect(isVirtualTaskSessionKey('agent:main:cron:job-1:2026-09-03')).toBe(true);
    expect(isVirtualTaskSessionKey('claude-task:task-1:2026-09-03')).toBe(true);
  });

  it('does not classify ordinary PI chat sessions as scheduled-task sessions', () => {
    expect(isVirtualTaskSessionKey('pi:main:chat-1')).toBe(false);
    expect(isVirtualTaskSessionKey('pi-task:task-1:not-a-date')).toBe(false);
  });
});
