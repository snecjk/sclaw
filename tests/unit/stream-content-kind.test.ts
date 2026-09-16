import { describe, expect, it } from 'vitest';
import { resolveStreamContentKind } from '../../electron/message-channel/common/stream-content-kind';

describe('resolveStreamContentKind', () => {
  it('marks finalize as answer', () => {
    expect(resolveStreamContentKind({ finalize: true, answer: '' })).toBe('answer');
    expect(resolveStreamContentKind({ finalize: true, answer: '你好' })).toBe('answer');
  });

  it('marks non-empty answer as answer even mid-stream', () => {
    expect(resolveStreamContentKind({ finalize: false, answer: '正文' })).toBe('answer');
  });

  it('marks empty answer as think (process placeholder)', () => {
    expect(resolveStreamContentKind({ finalize: false, answer: '' })).toBe('think');
    expect(resolveStreamContentKind({ finalize: false, answer: '   ' })).toBe('think');
  });
});
