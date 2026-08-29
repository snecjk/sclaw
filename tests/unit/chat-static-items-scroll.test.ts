import { describe, expect, it } from 'vitest';
import {
  measureChatScroll,
  shouldArmOlderHistoryLoader,
  shouldLoadOlderHistoryFromScroll,
  createOlderHistoryScrollController,
  restoreScrollAfterPrepend,
} from '@/components/chat/chat-static-items-scroll';

describe('chat static items older-history scroll', () => {
  it('does not arm while the list is still at the top of an unmeasured layout', () => {
    const metrics = measureChatScroll({
      scrollTop: 0,
      scrollHeight: 400,
      clientHeight: 400,
    });
    expect(shouldArmOlderHistoryLoader(metrics)).toBe(false);
    expect(shouldLoadOlderHistoryFromScroll(false, metrics)).toBe(false);
  });

  it('arms after stick-to-bottom and does not load older there', () => {
    const metrics = measureChatScroll({
      scrollTop: 3600,
      scrollHeight: 4000,
      clientHeight: 400,
    });
    expect(shouldArmOlderHistoryLoader(metrics)).toBe(true);
    expect(shouldLoadOlderHistoryFromScroll(true, metrics)).toBe(false);
  });

  it('loads older only after arming when the user scrolls to the top', () => {
    const metrics = measureChatScroll({
      scrollTop: 0,
      scrollHeight: 4000,
      clientHeight: 400,
    });
    expect(shouldLoadOlderHistoryFromScroll(false, metrics)).toBe(false);
    expect(shouldLoadOlderHistoryFromScroll(true, metrics)).toBe(true);
  });
});

describe('createOlderHistoryScrollController', () => {
  it('fires once at the top and waits until the user leaves before firing again', () => {
    const controller = createOlderHistoryScrollController();
    const bottom = measureChatScroll({
      scrollTop: 3600,
      scrollHeight: 4000,
      clientHeight: 400,
    });
    const top = measureChatScroll({
      scrollTop: 0,
      scrollHeight: 4000,
      clientHeight: 400,
    });
    expect(controller.onMetrics(bottom)).toBe('idle');
    expect(controller.onMetrics(top)).toBe('load');
    expect(controller.onMetrics(top)).toBe('idle');
    expect(controller.onMetrics(bottom)).toBe('idle');
    expect(controller.onMetrics(top)).toBe('load');
  });
});

describe('restoreScrollAfterPrepend', () => {
  it('keeps the previously visible messages in place after older rows are inserted', () => {
    const el = { scrollTop: 0, scrollHeight: 8000 };
    expect(restoreScrollAfterPrepend(el, 4000)).toBe(8000);
    expect(el.scrollTop).toBe(4000);
  });
});
