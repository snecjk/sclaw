import { describe, expect, it } from 'vitest';
import { estimateJsonBytes, formatPayloadSize } from '@/stores/chat/history-load-perf';

describe('history load perf helpers', () => {
  it('estimates JSON payload bytes', () => {
    const bytes = estimateJsonBytes([{ role: 'user', content: 'hello' }]);
    expect(bytes).toBeGreaterThan(10);
  });

  it('formats human-readable payload sizes', () => {
    expect(formatPayloadSize(512)).toBe('512B');
    expect(formatPayloadSize(2048)).toBe('2.0KB');
    expect(formatPayloadSize(2 * 1024 * 1024)).toBe('2.00MB');
  });
});
