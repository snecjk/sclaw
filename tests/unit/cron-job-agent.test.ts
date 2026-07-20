import { describe, expect, it } from 'vitest';
import { preferCronDatedSessionKey, resolveCronJobAgentId } from '../../shared/cron-job-agent';

describe('resolveCronJobAgentId', () => {
  it('reads agentId from description JSON', () => {
    expect(resolveCronJobAgentId(JSON.stringify({ agentId: 'ops' }))).toBe('ops');
  });

  it('defaults to main when description missing or invalid', () => {
    expect(resolveCronJobAgentId(undefined)).toBe('main');
    expect(resolveCronJobAgentId('not-json')).toBe('main');
    expect(resolveCronJobAgentId(JSON.stringify({}))).toBe('main');
  });
});

describe('preferCronDatedSessionKey', () => {
  it('prefers non-main agent twin', () => {
    expect(preferCronDatedSessionKey([
      'agent:main:cron:job-1:2026-06-28',
      'agent:ops:cron:job-1:2026-06-28',
    ])).toBe('agent:ops:cron:job-1:2026-06-28');
  });

  it('prefers explicit preferredKey over non-main default', () => {
    expect(preferCronDatedSessionKey(
      [
        'agent:main:cron:job-1:2026-06-28',
        'agent:ops:cron:job-1:2026-06-28',
      ],
      'agent:main:cron:job-1:2026-06-28',
    )).toBe('agent:main:cron:job-1:2026-06-28');
  });
});
