import { describe, expect, it } from 'vitest';
import {
  buildGatewayEventDedupeKey,
  createGatewayEventDeduper,
} from '@/stores/chat/gateway-event-dedupe';

describe('gateway event dedupe', () => {
  it('builds stable keys for message snapshots with useful content', () => {
    expect(buildGatewayEventDedupeKey({
      runId: 'run-1',
      state: 'final',
      message: {
        id: 'msg-1',
        role: 'assistant',
        content: [{ type: 'text', text: 'hello' }],
      },
    })).toBe('msg|run-1|final|msg-1||assistant|hello|5');
  });

  it('falls back to run/session/seq/state keys when no message identity exists', () => {
    expect(buildGatewayEventDedupeKey({
      runId: 'run-2',
      sessionKey: 'agent:main',
      seq: 3,
      state: 'delta',
    })).toBe('run-2|agent:main|3|delta');
  });

  it('dedupes repeated events until the TTL expires', () => {
    const deduper = createGatewayEventDeduper(100);
    const event = {
      runId: 'run-3',
      sessionKey: 'agent:main',
      seq: 1,
      state: 'started',
    };

    expect(deduper.shouldProcess(event, 1_000)).toBe(true);
    expect(deduper.shouldProcess(event, 1_050)).toBe(false);
    expect(deduper.shouldProcess(event, 1_101)).toBe(true);
  });

  it('does not dedupe events that have no usable key', () => {
    const deduper = createGatewayEventDeduper(100);
    expect(deduper.shouldProcess({ message: {} }, 1_000)).toBe(true);
    expect(deduper.shouldProcess({ message: {} }, 1_001)).toBe(true);
  });
});

