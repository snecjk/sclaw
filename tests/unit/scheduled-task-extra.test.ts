import { describe, expect, it } from 'vitest';
import { mergeScheduledTaskExtra } from '../../shared/scheduled-task-extra';

describe('mergeScheduledTaskExtra', () => {
  it('keeps createdVia and unknown keys when incoming only has composer fields', () => {
    const merged = mergeScheduledTaskExtra(
      { createdVia: 'nl', other: 1, composerSegments: [{ type: 'text', text: 'old' }] },
      { composerSegments: [{ type: 'text', text: 'new' }], composerAttachments: [] },
    );
    expect(merged.createdVia).toBe('nl');
    expect(merged.other).toBe(1);
    expect(merged.composerSegments).toEqual([{ type: 'text', text: 'new' }]);
    expect(merged.composerAttachments).toEqual([]);
  });

  it('treats missing existing extra as empty object', () => {
    expect(mergeScheduledTaskExtra(null, { createdVia: 'ui' })).toEqual({ createdVia: 'ui' });
    expect(mergeScheduledTaskExtra(undefined, { a: 1 })).toEqual({ a: 1 });
  });
});
