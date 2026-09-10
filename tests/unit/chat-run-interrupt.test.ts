import { describe, expect, it } from 'vitest';
import {
  classifyChatRunInterrupt,
  inheritChatRunInterruptCause,
} from '../../shared/chat-run-interrupt';

describe('classifyChatRunInterrupt', () => {
  it('maps iterator_eof to stream_closed', () => {
    expect(classifyChatRunInterrupt('iterator_eof')).toBe('stream_closed');
  });

  it('maps tool timeout separately from stream close', () => {
    expect(classifyChatRunInterrupt('bridge_click timeout')).toBe('tool_timeout');
  });
});

describe('inheritChatRunInterruptCause', () => {
  it('does not inherit from a successful completed run', () => {
    expect(inheritChatRunInterruptCause({
      phase: 'completed',
      interruptCause: 'stream_closed',
    })).toBeNull();
  });

  it('copies the stored cause from a failed run', () => {
    expect(inheritChatRunInterruptCause({
      phase: 'failed',
      interruptCause: 'stream_closed',
    })).toBe('stream_closed');
  });

  it('treats aborted without a stored cause as user_abort', () => {
    expect(inheritChatRunInterruptCause({ phase: 'aborted' })).toBe('user_abort');
  });

  it('treats reconciling as process_restart', () => {
    expect(inheritChatRunInterruptCause({ phase: 'reconciling' })).toBe('process_restart');
  });
});
