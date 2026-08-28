import { describe, expect, it } from 'vitest';
import {
  nearestScrollTopDelta,
  shouldIgnorePopoverRepositionScroll,
} from '@/components/dingtalk/mention-popover-scroll';

describe('nearestScrollTopDelta', () => {
  it('returns 0 when the child is fully visible', () => {
    expect(nearestScrollTopDelta({
      childTop: 120,
      childBottom: 160,
      containerTop: 100,
      containerBottom: 300,
    })).toBe(0);
  });

  it('scrolls up when the child is above the viewport', () => {
    expect(nearestScrollTopDelta({
      childTop: 80,
      childBottom: 120,
      containerTop: 100,
      containerBottom: 300,
    })).toBe(-20);
  });

  it('scrolls down when the child is below the viewport', () => {
    expect(nearestScrollTopDelta({
      childTop: 280,
      childBottom: 330,
      containerTop: 100,
      containerBottom: 300,
    })).toBe(30);
  });
});

describe('shouldIgnorePopoverRepositionScroll', () => {
  it('ignores scroll events that originate inside the panel', () => {
    const panel = document.createElement('div');
    const list = document.createElement('div');
    panel.appendChild(list);
    const event = new Event('scroll', { bubbles: false });
    Object.defineProperty(event, 'target', { value: list });
    expect(shouldIgnorePopoverRepositionScroll(event, panel)).toBe(true);
  });

  it('does not ignore page / document scroll', () => {
    const panel = document.createElement('div');
    const event = new Event('scroll', { bubbles: false });
    Object.defineProperty(event, 'target', { value: document });
    expect(shouldIgnorePopoverRepositionScroll(event, panel)).toBe(false);
  });

  it('does not ignore resize or missing root', () => {
    const panel = document.createElement('div');
    expect(shouldIgnorePopoverRepositionScroll(new Event('resize'), panel)).toBe(false);
    const scroll = new Event('scroll');
    Object.defineProperty(scroll, 'target', { value: panel });
    expect(shouldIgnorePopoverRepositionScroll(scroll, null)).toBe(false);
  });
});
