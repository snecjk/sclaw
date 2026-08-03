import { describe, expect, it } from 'vitest';
import {
  OVERLAY_SCROLLBAR_MIN_THUMB_HEIGHT,
  calculateOverlayScrollbarMetrics,
  scrollTopFromThumbDelta,
} from '@/lib/overlay-scrollbar-metrics';

describe('calculateOverlayScrollbarMetrics', () => {
  it('returns no overflow when scrollHeight === clientHeight', () => {
    const m = calculateOverlayScrollbarMetrics({
      scrollTop: 0,
      scrollHeight: 400,
      clientHeight: 400,
      trackHeight: 392,
    });
    expect(m.hasOverflow).toBe(false);
    expect(m.thumbHeight).toBe(0);
    expect(m.thumbTop).toBe(0);
    expect(m.maxScrollTop).toBe(0);
  });

  it('returns no overflow when scrollHeight < clientHeight', () => {
    const m = calculateOverlayScrollbarMetrics({
      scrollTop: 0,
      scrollHeight: 100,
      clientHeight: 400,
      trackHeight: 392,
    });
    expect(m.hasOverflow).toBe(false);
  });

  it('clamps thumb to min height for very long content', () => {
    const trackHeight = 400;
    const m = calculateOverlayScrollbarMetrics({
      scrollTop: 0,
      scrollHeight: 40_000,
      clientHeight: 400,
      trackHeight,
      minThumbHeight: OVERLAY_SCROLLBAR_MIN_THUMB_HEIGHT,
    });
    expect(m.hasOverflow).toBe(true);
    expect(m.thumbHeight).toBe(OVERLAY_SCROLLBAR_MIN_THUMB_HEIGHT);
    expect(m.maxThumbTop).toBe(trackHeight - OVERLAY_SCROLLBAR_MIN_THUMB_HEIGHT);
  });

  it('does not exceed track when track shorter than min thumb', () => {
    const m = calculateOverlayScrollbarMetrics({
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 100,
      trackHeight: 20,
      minThumbHeight: 32,
    });
    expect(m.thumbHeight).toBe(20);
    expect(m.maxThumbTop).toBe(0);
  });

  it('places thumb at top when scrollTop is 0', () => {
    const m = calculateOverlayScrollbarMetrics({
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 500,
      trackHeight: 400,
    });
    expect(m.thumbTop).toBe(0);
    expect(m.maxScrollTop).toBe(500);
  });

  it('places thumb at bottom when scrollTop is max', () => {
    const m = calculateOverlayScrollbarMetrics({
      scrollTop: 500,
      scrollHeight: 1000,
      clientHeight: 500,
      trackHeight: 400,
    });
    expect(m.thumbTop).toBe(m.maxThumbTop);
  });

  it('places thumb mid-track for mid scrollTop', () => {
    const m = calculateOverlayScrollbarMetrics({
      scrollTop: 250,
      scrollHeight: 1000,
      clientHeight: 500,
      trackHeight: 400,
    });
    expect(m.thumbHeight).toBe(200);
    expect(m.maxThumbTop).toBe(200);
    expect(m.thumbTop).toBe(100);
  });

  it('clamps out-of-range scrollTop', () => {
    const high = calculateOverlayScrollbarMetrics({
      scrollTop: 9999,
      scrollHeight: 1000,
      clientHeight: 500,
      trackHeight: 400,
    });
    expect(high.thumbTop).toBe(high.maxThumbTop);

    const low = calculateOverlayScrollbarMetrics({
      scrollTop: -50,
      scrollHeight: 1000,
      clientHeight: 500,
      trackHeight: 400,
    });
    expect(low.thumbTop).toBe(0);
  });

  it('degrades non-finite or negative sizes to zero metrics', () => {
    expect(
      calculateOverlayScrollbarMetrics({
        scrollTop: 0,
        scrollHeight: Number.NaN,
        clientHeight: 400,
        trackHeight: 400,
      }).hasOverflow,
    ).toBe(false);

    expect(
      calculateOverlayScrollbarMetrics({
        scrollTop: 0,
        scrollHeight: 800,
        clientHeight: -1,
        trackHeight: 400,
      }).hasOverflow,
    ).toBe(false);

    expect(
      calculateOverlayScrollbarMetrics({
        scrollTop: Number.POSITIVE_INFINITY,
        scrollHeight: 800,
        clientHeight: 400,
        trackHeight: 400,
      }).hasOverflow,
    ).toBe(false);
  });
});

describe('scrollTopFromThumbDelta', () => {
  it('maps thumb delta proportionally to scrollTop', () => {
    const next = scrollTopFromThumbDelta({
      startScrollTop: 0,
      deltaY: 100,
      maxScrollTop: 500,
      maxThumbTop: 200,
    });
    expect(next).toBe(250);
  });

  it('clamps to maxScrollTop', () => {
    const next = scrollTopFromThumbDelta({
      startScrollTop: 400,
      deltaY: 200,
      maxScrollTop: 500,
      maxThumbTop: 200,
    });
    expect(next).toBe(500);
  });

  it('returns start clamped when maxThumbTop is 0', () => {
    const next = scrollTopFromThumbDelta({
      startScrollTop: 10,
      deltaY: 50,
      maxScrollTop: 100,
      maxThumbTop: 0,
    });
    expect(next).toBe(10);
  });
});
