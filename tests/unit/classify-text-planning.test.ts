import { describe, expect, it } from 'vitest';
import {
  isLikelyPlanningNarration,
  shouldPromoteTextToFinalReply,
} from '@/pages/Chat/thinking/classify-text';

describe('isLikelyPlanningNarration (English)', () => {
  it('treats short English tool-planning as narration', () => {
    expect(isLikelyPlanningNarration('Now let me query the latest metrics.')).toBe(true);
    expect(isLikelyPlanningNarration('Let me search for a relevant skill.')).toBe(true);
    expect(isLikelyPlanningNarration("I'll check the workflow template first.")).toBe(true);
  });

  it('does not treat deliverable markdown as planning', () => {
    const table = '| Col A | Col B |\n| --- | --- |\n| 1 | 2 |';
    expect(isLikelyPlanningNarration(table)).toBe(false);
  });
});

describe('shouldPromoteTextToFinalReply', () => {
  it('does not promote English planning during live stream', () => {
    const text = 'Now let me query the database for last week.';
    expect(
      shouldPromoteTextToFinalReply(text, true, 0, 0, false),
    ).toBe(false);
  });
});
