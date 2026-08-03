import { act, fireEvent, render, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverlayScrollbar } from '@/components/ui/overlay-scrollbar';
import { useOverlayScrollbar } from '@/hooks/use-overlay-scrollbar';
import { OVERLAY_SCROLLBAR_SCROLL_STOP_MS } from '@/lib/overlay-scrollbar-metrics';

type ResizeCb = ResizeObserverCallback;

class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];
  callback: ResizeCb;
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  constructor(callback: ResizeCb) {
    this.callback = callback;
    ResizeObserverStub.instances.push(this);
  }
}

function setBox(
  el: HTMLElement,
  box: {
    clientHeight: number;
    scrollHeight: number;
    scrollTop?: number;
    trackHeight?: number;
  },
) {
  Object.defineProperty(el, 'clientHeight', {
    configurable: true,
    get: () => box.clientHeight,
  });
  Object.defineProperty(el, 'scrollHeight', {
    configurable: true,
    get: () => box.scrollHeight,
  });
  let scrollTop = box.scrollTop ?? 0;
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v;
    },
  });
  if (box.trackHeight !== undefined) {
    Object.defineProperty(el, 'clientHeight', {
      configurable: true,
      get: () => box.clientHeight,
    });
  }
}

function setClientHeight(el: HTMLElement, height: number) {
  Object.defineProperty(el, 'clientHeight', {
    configurable: true,
    get: () => height,
  });
}

describe('useOverlayScrollbar', () => {
  let rafQueue: FrameRequestCallback[];
  let viewport: HTMLDivElement;
  let content: HTMLDivElement;
  let root: HTMLDivElement;
  let track: HTMLDivElement;
  let thumb: HTMLDivElement;
  let setPointerCapture: ReturnType<typeof vi.fn>;
  let releasePointerCapture: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    rafQueue = [];
    ResizeObserverStub.instances = [];
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafQueue[id - 1] = () => {};
    });

    setPointerCapture = vi.fn();
    releasePointerCapture = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: setPointerCapture,
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: releasePointerCapture,
    });
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: () => true,
    });

    viewport = document.createElement('div');
    content = document.createElement('div');
    root = document.createElement('div');
    track = document.createElement('div');
    thumb = document.createElement('div');
    viewport.appendChild(content);
    root.appendChild(track);
    track.appendChild(thumb);
    document.body.append(viewport, root);

    setBox(viewport, { clientHeight: 400, scrollHeight: 1000, scrollTop: 0 });
    setClientHeight(track, 392);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  function flushRaf() {
    const queue = [...rafQueue];
    rafQueue = [];
    for (const cb of queue) cb(performance.now());
  }

  function mount() {
    return renderHook(() => {
      const viewportRef = useRef(viewport);
      const contentRef = useRef(content);
      const rootRef = useRef(root);
      const trackRef = useRef(track);
      const thumbRef = useRef(thumb);
      useOverlayScrollbar({
        viewportRef,
        contentRef,
        rootRef,
        trackRef,
        thumbRef,
      });
    });
  }

  it('sets overflow and thumb geometry on mount via rAF path', () => {
    mount();
    expect(root.getAttribute('data-overflow')).toBe('true');
    expect(thumb.style.height).not.toBe('0px');
    expect(thumb.style.transform).toContain('translate3d');
  });

  it('hides overflow when scrollHeight === clientHeight', () => {
    setBox(viewport, { clientHeight: 400, scrollHeight: 400, scrollTop: 0 });
    mount();
    expect(root.getAttribute('data-overflow')).toBe('false');
    expect(root.getAttribute('data-active')).toBe('false');
  });

  it('scroll sets active; 119ms still active; 120ms clears without hover', () => {
    mount();
    act(() => {
      viewport.dispatchEvent(new Event('scroll'));
      flushRaf();
    });
    expect(root.getAttribute('data-active')).toBe('true');

    act(() => {
      vi.advanceTimersByTime(OVERLAY_SCROLLBAR_SCROLL_STOP_MS - 1);
    });
    expect(root.getAttribute('data-active')).toBe('true');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(root.getAttribute('data-active')).toBe('false');
  });

  it('merges consecutive scroll into one rAF metrics update', () => {
    mount();
    const heightBefore = thumb.style.height;
    act(() => {
      viewport.scrollTop = 100;
      viewport.dispatchEvent(new Event('scroll'));
      viewport.scrollTop = 200;
      viewport.dispatchEvent(new Event('scroll'));
      expect(rafQueue.length).toBe(1);
      flushRaf();
    });
    expect(thumb.style.height).toBe(heightBefore);
    expect(thumb.style.transform).toContain('translate3d(0,');
  });

  it('rail hover keeps active after scroll stop', () => {
    mount();
    act(() => {
      track.dispatchEvent(new PointerEvent('pointerenter'));
      viewport.dispatchEvent(new Event('scroll'));
      flushRaf();
      vi.advanceTimersByTime(OVERLAY_SCROLLBAR_SCROLL_STOP_MS);
    });
    expect(root.getAttribute('data-active')).toBe('true');

    act(() => {
      track.dispatchEvent(new PointerEvent('pointerleave'));
    });
    expect(root.getAttribute('data-active')).toBe('false');
  });

  it('resize observer callback reschedules geometry', () => {
    mount();
    expect(ResizeObserverStub.instances.length).toBeGreaterThan(0);
    const observer = ResizeObserverStub.instances[0];
    act(() => {
      setBox(viewport, { clientHeight: 300, scrollHeight: 1200, scrollTop: 0 });
      setClientHeight(track, 292);
      observer.callback([], observer as unknown as ResizeObserver);
      flushRaf();
    });
    expect(root.getAttribute('data-overflow')).toBe('true');
    expect(Number.parseFloat(thumb.style.height)).toBeGreaterThan(0);
  });

  it('thumb drag updates viewport scrollTop and sets dragging', () => {
    mount();
    act(() => {
      fireEvent.pointerDown(thumb, {
        button: 0,
        clientY: 40,
        pointerId: 1,
      });
    });
    expect(root.getAttribute('data-dragging')).toBe('true');
    expect(setPointerCapture).toHaveBeenCalled();

    act(() => {
      fireEvent.pointerMove(thumb, {
        clientY: 140,
        pointerId: 1,
      });
      flushRaf();
    });
    expect(viewport.scrollTop).toBeGreaterThan(0);

    act(() => {
      fireEvent.pointerUp(thumb, { pointerId: 1 });
    });
    expect(root.getAttribute('data-dragging')).toBe('false');
    expect(releasePointerCapture).toHaveBeenCalled();
  });

  it('unmount cleans attributes and disconnects observer', () => {
    const { unmount } = mount();
    const observer = ResizeObserverStub.instances[0];
    act(() => {
      viewport.dispatchEvent(new Event('scroll'));
    });
    expect(root.getAttribute('data-active')).toBe('true');

    unmount();
    expect(observer.disconnect).toHaveBeenCalled();
    expect(root.getAttribute('data-overflow')).toBe('false');
    expect(root.getAttribute('data-active')).toBe('false');
    expect(root.getAttribute('data-dragging')).toBe('false');

    act(() => {
      viewport.dispatchEvent(new Event('scroll'));
    });
    expect(root.getAttribute('data-active')).toBe('false');
  });
});

describe('OverlayScrollbar component', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('renders aria-hidden rail/thumb without role=scrollbar', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});

    function Harness() {
      const viewportRef = useRef<HTMLDivElement>(null);
      const contentRef = useRef<HTMLDivElement>(null);
      return (
        <div className="relative">
          <div ref={viewportRef} className="sto-overlay-scroll-viewport">
            <div ref={contentRef}>content</div>
          </div>
          <OverlayScrollbar viewportRef={viewportRef} contentRef={contentRef} />
        </div>
      );
    }

    const { container } = render(<Harness />);
    const overlay = container.querySelector('.sto-overlay-scrollbar');
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute('aria-hidden')).toBe('true');
    expect(overlay?.getAttribute('role')).toBeNull();
    expect(container.querySelector('.sto-overlay-scrollbar-rail')).not.toBeNull();
    expect(container.querySelector('.sto-overlay-scrollbar-thumb')).not.toBeNull();
  });
});
