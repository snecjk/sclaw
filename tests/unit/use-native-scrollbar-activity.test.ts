import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { useNativeScrollbarActivity } from '@/hooks/use-native-scrollbar-activity';

function makeDiv(): HTMLDivElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function firePointerEnter(el: HTMLElement) {
  el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
}

function firePointerLeave(el: HTMLElement) {
  el.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false }));
}

function fireScroll(el: HTMLElement) {
  el.dispatchEvent(new Event('scroll'));
}

const ATTR = 'data-scrollbar-active';

describe('useNativeScrollbarActivity', () => {
  let el: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    el = makeDiv();
  });

  afterEach(() => {
    vi.useRealTimers();
    el.remove();
  });

  function renderWithRef(element: HTMLDivElement) {
    return renderHook(() => {
      const ref = useRef<HTMLDivElement>(element);
      useNativeScrollbarActivity(ref);
    });
  }

  it('initial state is not active', () => {
    renderWithRef(el);
    expect(el.hasAttribute(ATTR)).toBe(false);
  });

  it('scroll sets active immediately', () => {
    renderWithRef(el);
    fireScroll(el);
    expect(el.getAttribute(ATTR)).toBe('true');
  });

  it('scroll after 119ms still active', () => {
    renderWithRef(el);
    fireScroll(el);
    vi.advanceTimersByTime(119);
    expect(el.getAttribute(ATTR)).toBe('true');
  });

  it('scroll after 120ms without hover removes active', () => {
    renderWithRef(el);
    fireScroll(el);
    vi.advanceTimersByTime(120);
    expect(el.hasAttribute(ATTR)).toBe(false);
  });

  it('consecutive scrolls reset the 120ms detection', () => {
    renderWithRef(el);
    fireScroll(el);
    vi.advanceTimersByTime(100);
    fireScroll(el);
    vi.advanceTimersByTime(100);
    expect(el.getAttribute(ATTR)).toBe('true');
    vi.advanceTimersByTime(20);
    expect(el.hasAttribute(ATTR)).toBe(false);
  });

  it('hover keeps active even after scroll stops', () => {
    renderWithRef(el);
    firePointerEnter(el);
    fireScroll(el);
    vi.advanceTimersByTime(120);
    expect(el.getAttribute(ATTR)).toBe('true');
  });

  it('pointer enter sets active immediately', () => {
    renderWithRef(el);
    firePointerEnter(el);
    expect(el.getAttribute(ATTR)).toBe('true');
  });

  it('pointer leave without scrolling removes active immediately', () => {
    renderWithRef(el);
    firePointerEnter(el);
    firePointerLeave(el);
    expect(el.hasAttribute(ATTR)).toBe(false);
  });

  it('pointer leave during scroll keeps active until scroll stops', () => {
    renderWithRef(el);
    firePointerEnter(el);
    fireScroll(el);
    firePointerLeave(el);
    expect(el.getAttribute(ATTR)).toBe('true');
    vi.advanceTimersByTime(120);
    expect(el.hasAttribute(ATTR)).toBe(false);
  });

  it('click/focus does not cause active', () => {
    renderWithRef(el);
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(el.hasAttribute(ATTR)).toBe(false);
  });

  it('unmount cleans up attribute and stops responding', () => {
    const { unmount } = renderWithRef(el);
    firePointerEnter(el);
    expect(el.getAttribute(ATTR)).toBe('true');
    unmount();
    expect(el.hasAttribute(ATTR)).toBe(false);
    firePointerEnter(el);
    expect(el.hasAttribute(ATTR)).toBe(false);
  });
});
