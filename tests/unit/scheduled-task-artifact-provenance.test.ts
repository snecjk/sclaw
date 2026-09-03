import { describe, expect, it } from 'vitest';
import { getScheduledTaskIdFromSessionKey } from '@/lib/scheduled-task-artifact-provenance';

describe('getScheduledTaskIdFromSessionKey', () => {
  it('extracts the task id from PI scheduled-task sessions', () => {
    expect(getScheduledTaskIdFromSessionKey('pi-task:task-pi:2026-09-03')).toBe('task-pi');
  });
});
