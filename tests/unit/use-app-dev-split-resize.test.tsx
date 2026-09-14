import { useEffect } from 'react';
import { act, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppDevSplitResize } from '@/hooks/use-app-dev-split-resize';
import { APP_DEV_SPLIT_RESIZE_SHIELD_ID } from '@/lib/app-dev-split';

function Harness({
  percent,
  onPersist,
  enabled = true,
}: {
  percent: number;
  onPersist: (p: number) => void;
  enabled?: boolean;
}) {
  const {
    splitRowRef,
    chatPanelRef,
    startResize,
    adjustChatPercent,
    isResizing,
  } = useAppDevSplitResize(percent, onPersist, enabled);

  useEffect(() => {
    (window as unknown as { __appDevSplitHarness?: unknown }).__appDevSplitHarness = {
      startResize,
      adjustChatPercent,
      isResizing,
      getCol: () => splitRowRef.current?.style.getPropertyValue('--app-dev-chat-col') ?? '',
    };
  });

  return (
    <div ref={splitRowRef} data-testid="split-row" style={{ width: 1000 }}>
      <section
        ref={chatPanelRef}
        data-testid="chat-panel"
        style={{ width: 280 }}
      />
      <div data-testid="stage" />
      <div
        data-testid="resize-handle"
        onPointerDown={startResize}
      />
    </div>
  );
}

describe('useAppDevSplitResize', () => {
  let rafQueue: FrameRequestCallback[];
  let setPointerCapture: ReturnType<typeof vi.fn>;
  let releasePointerCapture: ReturnType<typeof vi.fn>;
  let hasPointerCapture: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rafQueue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafQueue[id - 1] = () => {};
    });

    setPointerCapture = vi.fn();
    releasePointerCapture = vi.fn();
    hasPointerCapture = vi.fn(() => true);

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
      value: hasPointerCapture,
    });

    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return (this as HTMLElement).style.width
          ? Number.parseFloat((this as HTMLElement).style.width) || 1000
          : 1000;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as { __appDevSplitHarness?: unknown }).__appDevSplitHarness;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    document.getElementById(APP_DEV_SPLIT_RESIZE_SHIELD_ID)?.remove();
  });

  function flushRaf() {
    const queue = [...rafQueue];
    rafQueue = [];
    for (const cb of queue) cb(0);
  }

  function getHarness() {
    return (window as unknown as {
      __appDevSplitHarness: {
        startResize: (e: React.PointerEvent<HTMLDivElement>) => void;
        adjustChatPercent: (d: number) => void;
        isResizing: boolean;
        getCol: () => string;
      };
    }).__appDevSplitHarness;
  }

  it('writes percent on idle', () => {
    const onPersist = vi.fn();
    render(<Harness percent={28} onPersist={onPersist} />);
    expect(getHarness().getCol()).toBe('28%');
    expect(document.getElementById(APP_DEV_SPLIT_RESIZE_SHIELD_ID)).toBeNull();
  });

  it('writes px during pointermove and restores percent on pointerup', () => {
    const onPersist = vi.fn();
    const { getByTestId } = render(<Harness percent={28} onPersist={onPersist} />);
    const handle = getByTestId('resize-handle');
    Object.defineProperty(getByTestId('chat-panel'), 'offsetWidth', {
      configurable: true,
      value: 280,
    });

    act(() => {
      fireEvent.pointerDown(handle, {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: 280,
      });
    });

    expect(setPointerCapture).toHaveBeenCalledWith(1);
    expect(getHarness().isResizing).toBe(true);
    expect(document.getElementById(APP_DEV_SPLIT_RESIZE_SHIELD_ID)).not.toBeNull();

    act(() => {
      window.dispatchEvent(
        new PointerEvent('pointermove', { pointerId: 1, clientX: 400 }),
      );
      flushRaf();
    });

    const during = getHarness().getCol();
    expect(during.endsWith('px')).toBe(true);
    expect(during).not.toContain('%');
    expect(during).toBe('400px');

    act(() => {
      window.dispatchEvent(
        new PointerEvent('pointerup', { pointerId: 1, clientX: 400 }),
      );
    });

    expect(getHarness().getCol()).toMatch(/%$/);
    expect(onPersist).toHaveBeenCalled();
    expect(getHarness().isResizing).toBe(false);
    expect(document.getElementById(APP_DEV_SPLIT_RESIZE_SHIELD_ID)).toBeNull();
  });

  it('cancels on pointercancel and restores the previous percent', () => {
    const onPersist = vi.fn();
    document.body.style.userSelect = 'text';
    document.body.style.cursor = 'default';
    const { getByTestId } = render(<Harness percent={28} onPersist={onPersist} />);
    const handle = getByTestId('resize-handle');
    Object.defineProperty(getByTestId('chat-panel'), 'offsetWidth', {
      configurable: true,
      value: 280,
    });

    act(() => {
      fireEvent.pointerDown(handle, {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: 280,
      });
    });
    expect(document.body.style.cursor).toBe('col-resize');

    act(() => {
      window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
    });

    expect(document.body.style.userSelect).toBe('text');
    expect(document.body.style.cursor).toBe('default');
    expect(getHarness().getCol()).toBe('28%');
    expect(onPersist).not.toHaveBeenCalled();
    expect(getHarness().isResizing).toBe(false);
    expect(document.getElementById(APP_DEV_SPLIT_RESIZE_SHIELD_ID)).toBeNull();
  });

  it('cleans up the shield on unmount', () => {
    const onPersist = vi.fn();
    const { getByTestId, unmount } = render(
      <Harness percent={28} onPersist={onPersist} />,
    );
    const handle = getByTestId('resize-handle');
    Object.defineProperty(getByTestId('chat-panel'), 'offsetWidth', {
      configurable: true,
      value: 280,
    });

    act(() => {
      fireEvent.pointerDown(handle, {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: 280,
      });
    });

    unmount();
    expect(document.getElementById(APP_DEV_SPLIT_RESIZE_SHIELD_ID)).toBeNull();
    expect(document.body.style.cursor).not.toBe('col-resize');
  });

  it('adjusts by 1% with keyboard helper and clamps to 22–55', () => {
    const onPersist = vi.fn();
    const { result } = renderHook(() => useAppDevSplitResize(28, onPersist, true));

    act(() => {
      result.current.adjustChatPercent(1);
    });
    expect(onPersist).toHaveBeenLastCalledWith(29);

    act(() => {
      result.current.adjustChatPercent(100);
    });
    expect(onPersist).toHaveBeenLastCalledWith(55);

    act(() => {
      result.current.adjustChatPercent(-100);
    });
    expect(onPersist).toHaveBeenLastCalledWith(22);
  });
});
