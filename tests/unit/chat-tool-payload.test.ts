import { describe, expect, it } from 'vitest';
import {
  STREAMING_OVERLAY_BUFFER_LIMIT,
  TOOL_PAYLOAD_MAX_CHARS,
  capWindow,
  truncateToolPayload,
} from '../../shared/chat-tool-payload';
import { appendStreamingToolResultSnapshot } from '@/stores/chat/streaming-state';

describe('truncateToolPayload', () => {
  it('caps long strings and nested tool input', () => {
    const long = 'x'.repeat(TOOL_PAYLOAD_MAX_CHARS + 80);
    const truncated = truncateToolPayload(long) as string;
    expect(truncated.length).toBeLessThan(long.length);
    expect(truncated.startsWith('x'.repeat(TOOL_PAYLOAD_MAX_CHARS))).toBe(true);

    const nested = truncateToolPayload({ input: { cmd: long } }) as { input: { cmd: string } };
    expect(nested.input.cmd.length).toBeLessThan(long.length);
  });
});

describe('capWindow', () => {
  it('keeps the newest items', () => {
    expect(capWindow([1, 2, 3, 4], 2)).toEqual([3, 4]);
  });
});

describe('appendStreamingToolResultSnapshot', () => {
  it('caps the overlay at the streaming window and truncates content', () => {
    let messages: ReturnType<typeof appendStreamingToolResultSnapshot> = [];
    for (let index = 0; index < STREAMING_OVERLAY_BUFFER_LIMIT + 12; index += 1) {
      messages = appendStreamingToolResultSnapshot(messages, {
        role: 'toolresult',
        id: `r${index}`,
        toolCallId: `c${index}`,
        content: 'y'.repeat(TOOL_PAYLOAD_MAX_CHARS + 40),
      });
    }
    expect(messages).toHaveLength(STREAMING_OVERLAY_BUFFER_LIMIT);
    expect(messages[0]?.id).toBe('r12');
    expect(String(messages[0]?.content).length).toBeLessThan(TOOL_PAYLOAD_MAX_CHARS + 40);
  });
});
