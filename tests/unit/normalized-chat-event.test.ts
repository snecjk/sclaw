import { describe, expect, it } from 'vitest';
import { normalizeChatEvent } from '@/stores/chat/normalized-chat-event';

describe('normalizeChatEvent', () => {
  it('preserves explicit event state and fields', () => {
    const normalized = normalizeChatEvent({
      currentSessionKey: 'agent:main:main',
      event: {
        state: 'started',
        runId: 'run-1',
        sessionKey: 'agent:main:main',
        phase: 'start',
      },
    });

    expect(normalized).toMatchObject({
      eventState: 'started',
      resolvedState: 'started',
      runId: 'run-1',
      eventSessionKey: 'agent:main:main',
      resolvedSessionKey: 'agent:main:main',
      phase: 'start',
      errorMessage: 'An error occurred',
    });
  });

  it('infers final when message has a stop reason', () => {
    const normalized = normalizeChatEvent({
      currentSessionKey: 'agent:main:main',
      event: {
        runId: 'run-2',
        sessionKey: 'agent:main:main',
        message: {
          role: 'assistant',
          content: 'done',
          stopReason: 'end_turn',
        },
      },
    });

    expect(normalized.resolvedState).toBe('final');
  });

  it('infers delta when message has role/content without stop reason', () => {
    const normalized = normalizeChatEvent({
      currentSessionKey: 'agent:main:main',
      event: {
        runId: 'run-3',
        sessionKey: 'agent:main:main',
        message: { role: 'assistant', content: 'streaming' },
      },
    });

    expect(normalized.resolvedState).toBe('delta');
  });

  it('maps cron run session keys to dated aggregate keys', () => {
    const normalized = normalizeChatEvent({
      currentSessionKey: 'agent:main:main',
      event: {
        sessionKey: 'agent:main:cron:job-1:run:run-abc',
        state: 'delta',
      },
    });

    expect(normalized.resolvedSessionKey).toMatch(/^agent:main:cron:job-1:\d{4}-\d{2}-\d{2}$/);
  });
});
