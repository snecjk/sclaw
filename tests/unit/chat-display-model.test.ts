import { describe, expect, it } from 'vitest';
import { buildChatDisplayModel } from '@/stores/chat/display-model';
import { createClientSessionState } from '@/stores/chat/client-session-reducer';

describe('chat display model', () => {
  it('projects optimistic and streaming overlays without mutating transcript', () => {
    const transcript = [{ id: 'history-1', role: 'user' as const, content: 'hello' }];
    const overlay = {
      ...createClientSessionState().overlay,
      optimisticUserMessage: { id: 'local-1', role: 'user' as const, content: 'next' },
      streamingMessage: { id: 'stream-1', role: 'assistant' as const, content: 'working' },
    };
    expect(buildChatDisplayModel(transcript, overlay).map((message) => message.id))
      .toEqual(['history-1', 'local-1', 'stream-1']);
    expect(transcript).toHaveLength(1);
  });

  it('does not duplicate an optimistic message after the transcript echoes its id', () => {
    const echoed = { id: 'local-1', role: 'user' as const, content: 'hello' };
    const overlay = {
      ...createClientSessionState().overlay,
      optimisticUserMessage: echoed,
    };
    expect(buildChatDisplayModel([echoed], overlay)).toEqual([echoed]);
  });
});

