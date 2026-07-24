import { describe, expect, it } from 'vitest';
import {
  claudeTaskGroupKey,
  cronTaskGroupKey,
  resolveTaskGroupKeyFromSessionKey,
  stoBuiltinTaskGroupKey,
} from '../../shared/task-group-key';

describe('task-group-key', () => {
  it('resolves cron dated session keys', () => {
    expect(resolveTaskGroupKeyFromSessionKey('agent:main:cron:job-1:2026-06-25')).toBe(cronTaskGroupKey('job-1'));
  });

  it('resolves Claude dated session keys', () => {
    expect(resolveTaskGroupKeyFromSessionKey('claude-task:abc:2026-06-25')).toBe(claudeTaskGroupKey('abc'));
  });

  it('resolves builtin STO legacy session keys', () => {
    expect(resolveTaskGroupKeyFromSessionKey('agent:main:sto-hq-reconciliation-2026-06-25')).toBe(
      stoBuiltinTaskGroupKey('hq-reconciliation'),
    );
  });

  it('returns null for unrelated session keys', () => {
    expect(resolveTaskGroupKeyFromSessionKey('agent:main:main')).toBeNull();
    expect(resolveTaskGroupKeyFromSessionKey('agent:main:session-sto-uuid')).toBeNull();
  });
});
