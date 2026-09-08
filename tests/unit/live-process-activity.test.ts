import { describe, expect, it } from 'vitest';
import { resolveLiveProcessActivity } from '@/pages/Chat/thinking/live-process-activity';

describe('resolveLiveProcessActivity', () => {
  it('prefers a running streaming tool over timeline history', () => {
    expect(resolveLiveProcessActivity(
      [{ type: 'thinking', content: 'plan' }],
      [{ name: 'Write', status: 'running' }],
    )).toEqual({ kind: 'tool', name: 'Write' });
  });

  it('falls back to the last timeline tool or thinking row', () => {
    expect(resolveLiveProcessActivity([
      { type: 'thinking', content: 'plan' },
      { type: 'tool', index: 1, id: 't1', name: 'Read', input: {} },
    ])).toEqual({ kind: 'tool', name: 'Read' });
    expect(resolveLiveProcessActivity([
      { type: 'thinking', content: 'plan' },
    ])).toEqual({ kind: 'thinking' });
  });
});
