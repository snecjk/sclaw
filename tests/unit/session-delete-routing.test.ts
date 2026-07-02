import { describe, expect, it } from 'vitest';
import { resolveSessionDeleteEngineType } from '@/lib/session-delete';
import {
  isClaudeTaskExecutionSessionKey,
  isOpenClawHostedTaskExecutionSessionKey,
} from '../../shared/session-delete-routing';

describe('session delete routing', () => {
  it('treats cron and scheduled-task agent sessions as openclaw-owned', () => {
    expect(isOpenClawHostedTaskExecutionSessionKey('agent:main:cron:job-1:2026-06-25')).toBe(true);
    expect(isOpenClawHostedTaskExecutionSessionKey('agent:main:scheduled-task:9:2026-06-25')).toBe(true);
    expect(isClaudeTaskExecutionSessionKey('claude-task:task-1:2026-06-25')).toBe(true);
    expect(resolveSessionDeleteEngineType('agent:main:cron:job-1:2026-06-25', undefined, 'claude')).toBe('openclaw');
    expect(resolveSessionDeleteEngineType('claude-task:task-1:2026-06-25')).toBe('claude');
  });
});
