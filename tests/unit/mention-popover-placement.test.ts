import { describe, expect, it } from 'vitest';
import {
  computeMentionPopoverPlacement,
  MENTION_POPOVER_GAP,
  MENTION_POPOVER_MAX_HEIGHT,
  MENTION_POPOVER_MIN_PANEL_HEIGHT,
  MENTION_POPOVER_WIDTH,
} from '@/components/dingtalk/mention-popover-placement';

const viewport = { viewportWidth: 800, viewportHeight: 600 };

describe('computeMentionPopoverPlacement', () => {
  it('places above caret when upward space is sufficient', () => {
    const result = computeMentionPopoverPlacement({
      ...viewport,
      caretRect: { top: 400, left: 120, right: 128, bottom: 432, width: 8, height: 32 },
    });
    expect(result.placement).toBe('above');
    expect(result.bottom).toBe(600 - 400 + MENTION_POPOVER_GAP);
    expect(result.top).toBeUndefined();
  });

  it('flips below when upward space is tight and downward is larger', () => {
    const result = computeMentionPopoverPlacement({
      ...viewport,
      caretRect: { top: 200, left: 120, right: 128, bottom: 232, width: 8, height: 32 },
    });
    expect(result.placement).toBe('below');
    expect(result.top).toBe(232 + MENTION_POPOVER_GAP);
    expect(result.bottom).toBeUndefined();
  });

  it('shifts left when panel would overflow the right edge at line end', () => {
    const result = computeMentionPopoverPlacement({
      ...viewport,
      caretRect: { top: 400, left: 760, right: 768, bottom: 432, width: 8, height: 32 },
    });
    expect(result.left).toBe(768 - MENTION_POPOVER_WIDTH);
    expect(result.left + MENTION_POPOVER_WIDTH).toBeLessThanOrEqual(800 - 12);
  });

  it('clamps maxHeight to available space below when flipping down', () => {
    const result = computeMentionPopoverPlacement({
      ...viewport,
      caretRect: { top: 180, left: 120, right: 128, bottom: 212, width: 8, height: 32 },
    });
    expect(result.placement).toBe('below');
    expect(result.maxHeight).toBeLessThanOrEqual(600 - 212 - 12 - MENTION_POPOVER_GAP);
    expect(result.maxHeight).toBeLessThanOrEqual(MENTION_POPOVER_MAX_HEIGHT);
  });

  it('does not inflate maxHeight above available upward space when both sides are tight', () => {
    const result = computeMentionPopoverPlacement({
      viewportWidth: 800,
      viewportHeight: 120,
      caretRect: { top: 62, left: 120, right: 128, bottom: 94, width: 8, height: 32 },
    });
    expect(result.placement).toBe('above');
    expect(result.maxHeight).toBe(62 - 12 - MENTION_POPOVER_GAP);
    expect(result.maxHeight).toBeLessThan(MENTION_POPOVER_MIN_PANEL_HEIGHT);
  });

  it('prefers above when caret is near bottom toolbar but upward space remains larger', () => {
    const result = computeMentionPopoverPlacement({
      ...viewport,
      caretRect: { top: 520, left: 200, right: 208, bottom: 552, width: 8, height: 32 },
    });
    expect(result.placement).toBe('above');
    expect(result.maxHeight).toBeLessThanOrEqual(520 - 12 - MENTION_POPOVER_GAP);
  });
});
