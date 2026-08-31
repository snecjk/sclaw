import { beforeEach, describe, expect, it } from 'vitest';
import { useChatRuntimeV2Store } from '@/stores/chat/runtime-v2-store';
import { getSessionDisplayMessages } from '@/stores/chat/display-selectors';
import type { CanonicalChatEvent } from '@/stores/chat/types';

const SESSION_KEY = 'agent:main:ref-stability';

function event(overrides: Partial<CanonicalChatEvent> = {}): CanonicalChatEvent {
  return {
    protocolVersion: 1,
    eventId: 'event-1',
    sessionKey: SESSION_KEY,
    runId: 'run-1',
    engineType: 'openclaw',
    epoch: 1,
    sequence: 1,
    occurredAt: 1_000,
    type: 'run.started',
    payload: {},
    ...overrides,
  } as CanonicalChatEvent;
}

/**
 * The display model feeds every ChatMessage as a prop. A fresh array identity on
 * each delta silently defeats memoization across the whole list, so identity
 * stability is a load-bearing contract rather than an optimization detail.
 */
describe('chat display model reference stability', () => {
  beforeEach(() => {
    useChatRuntimeV2Store.getState().clearSession(SESSION_KEY);
  });

  it('keeps one array identity across a delta burst', () => {
    const store = useChatRuntimeV2Store.getState();
    store.setTranscript(SESSION_KEY, [
      { id: 'u1', role: 'user', content: 'question', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'answer', timestamp: 2 },
    ]);

    const baseline = getSessionDisplayMessages(SESSION_KEY);
    expect(baseline).toHaveLength(2);

    for (let index = 0; index < 50; index += 1) {
      useChatRuntimeV2Store.getState().applyEvent(event({
        eventId: `delta-${index}`,
        sequence: index + 1,
        type: 'message.delta',
        payload: { id: 'run-1', role: 'assistant', content: `partial ${index}` },
      }));
    }

    expect(getSessionDisplayMessages(SESSION_KEY)).toBe(baseline);
  });

  it('keeps the identity when a transcript refresh carries equal content', () => {
    const store = useChatRuntimeV2Store.getState();
    const transcript = [{ id: 'u1', role: 'user', content: 'question', timestamp: 1 }];
    store.setTranscript(SESSION_KEY, transcript);

    const baseline = getSessionDisplayMessages(SESSION_KEY);
    // A separate array with identical content, as a poll-driven reload would deliver.
    store.setTranscript(SESSION_KEY, [...transcript]);

    expect(getSessionDisplayMessages(SESSION_KEY)).toBe(baseline);
  });

  it('produces a new identity when the transcript actually changes', () => {
    const store = useChatRuntimeV2Store.getState();
    store.setTranscript(SESSION_KEY, [
      { id: 'u1', role: 'user', content: 'question', timestamp: 1 },
    ]);

    const baseline = getSessionDisplayMessages(SESSION_KEY);
    store.setTranscript(SESSION_KEY, [
      { id: 'u1', role: 'user', content: 'question', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'answer', timestamp: 2 },
    ]);

    const next = getSessionDisplayMessages(SESSION_KEY);
    expect(next).not.toBe(baseline);
    expect(next).toHaveLength(2);
  });
});
