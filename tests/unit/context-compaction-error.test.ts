import { describe, expect, it } from 'vitest';

import { isSessionTooSmallToCompact } from '../../src/pages/Chat/context-usage/context-compaction-error';

describe('context compaction error', () => {
  it.each([
    'Nothing to compact (session too small)',
    'Compaction failed: Nothing to compact (SESSION TOO SMALL)',
  ])('recognizes Pi session-too-small responses: %s', (message) => {
    expect(isSessionTooSmallToCompact(message)).toBe(true);
  });

  it.each([
    'Nothing to compact',
    'session too small',
    'COMPACTION_IN_PROGRESS',
    'Network request failed',
  ])('does not hide real or ambiguous failures: %s', (message) => {
    expect(isSessionTooSmallToCompact(message)).toBe(false);
  });
});
