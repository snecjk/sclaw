import { useEffect } from 'react';
import { act, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSplitPanelResize } from '@/hooks/use-split-panel-resize';

function Harness({
  percent,
  onPersist,
}: {
  percent: number;
  onPersist: (p: number) => void;
}) {
  const {
    splitRowRef,
    previewPanelRef,
    startResize,
    adjustPreviewPercent,
    isResizing,
  } = useSplitPanelResize(percent, onPersist);

  useEffect(() => {
    (window as unknown as { __splitHarness?: unknown }).__splitHarness = {
      startResize,
      adjustPreviewPercent,
      isResizing,
      getCol: () =>
        document.querySelector('main')?.style.getPropertyValue('--sto-split-preview-col') ?? '',
    };
  });

  return (
    <main style={{ width: 1000, paddingLeft: '0px', paddingRight: '0px' }}>
      <div ref={splitRowRef} data-testid="split-row">
        <div
          ref={previewPanelRef}
          data-testid="preview-panel"
          style={{ width: 500 }}
        />
        <div
          data-testid="resize-handle"
          onPointerDown={startResize}
        />
      </div>
    </main>
  );
}

describe('useSplitPanelResize', () => {
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
    delete (window as unknown as { __splitHarness?: unknown }).__splitHarness;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    document.querySelectorAll('body > div').forEach((el) => {
      if ((el as HTMLElement).style.zIndex === '9999') el.remove();
    });
  });

  function flushRaf() {
    const queue = [...rafQueue];
    rafQueue = [];
    for (const cb of queue) cb(0);
  }

  function getHarness() {
    return (window as unknown as {
      __splitHarness: {
        startResize: (e: React.PointerEvent<HTMLDivElement>) => void;
        adjustPreviewPercent: (d: number) => void;
        isResizing: boolean;
        getCol: () => string;
      };
    }).__splitHarness;
  }

  it('writes percent on idle and does not create ResizeObserver', () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = observe;
        disconnect = disconnect;
        unobserve = vi.fn();
      },
    );

    const onPersist = vi.fn();
    render(<Harness percent={50} onPersist={onPersist} />);

    expect(getHarness().getCol()).toBe('50%');
    expect(observe).not.toHaveBeenCalled();
    expect(document.querySelector('body > div[style*="z-index: 9999"]')).toBeNull();
  });

  it('writes px during pointermove and restores percent on pointerup', () => {
    const onPersist = vi.fn();
    const { getByTestId } = render(<Harness percent={50} onPersist={onPersist} />);
    const handle = getByTestId('resize-handle');
    Object.defineProperty(getByTestId('preview-panel'), 'offsetWidth', {
      configurable: true,
      value: 500,
    });

    act(() => {
      fireEvent.pointerDown(handle, {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: 400,
      });
    });

    expect(setPointerCapture).toHaveBeenCalledWith(1);
    expect(getHarness().isResizing).toBe(true);

    act(() => {
      window.dispatchEvent(
        new PointerEvent('pointermove', { pointerId: 1, clientX: 300 }),
      );
      flushRaf();
    });

    const during = getHarness().getCol();
    expect(during.endsWith('px')).toBe(true);
    expect(during).not.toContain('%');

    act(() => {
      window.dispatchEvent(
        new PointerEvent('pointerup', { pointerId: 1, clientX: 300 }),
      );
    });

    expect(getHarness().getCol()).toMatch(/%$/);
    expect(onPersist).toHaveBeenCalled();
    expect(getHarness().isResizing).toBe(false);
    expect(document.querySelector('body > div[style*="z-index: 9999"]')).toBeNull();
  });

  it('ignores pointer events from a different pointerId', () => {
    const onPersist = vi.fn();
    const { getByTestId } = render(<Harness percent={50} onPersist={onPersist} />);
    const handle = getByTestId('resize-handle');
    Object.defineProperty(getByTestId('preview-panel'), 'offsetWidth', {
      configurable: true,
      value: 500,
    });

    act(() => {
      fireEvent.pointerDown(handle, {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: 400,
      });
    });

    const before = getHarness().getCol();
    act(() => {
      window.dispatchEvent(
        new PointerEvent('pointermove', { pointerId: 99, clientX: 100 }),
      );
      flushRaf();
    });
    expect(getHarness().getCol()).toBe(before);

    act(() => {
      window.dispatchEvent(
        new PointerEvent('pointerup', { pointerId: 99, clientX: 100 }),
      );
    });
    expect(getHarness().isResizing).toBe(true);
    expect(onPersist).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(
        new PointerEvent('pointerup', { pointerId: 1, clientX: 400 }),
      );
    });
    expect(getHarness().isResizing).toBe(false);
  });

  it('removes listeners and restores body styles on pointercancel', () => {
    const onPersist = vi.fn();
    document.body.style.userSelect = 'text';
    document.body.style.cursor = 'default';
    const { getByTestId } = render(<Harness percent={50} onPersist={onPersist} />);
    const handle = getByTestId('resize-handle');
    Object.defineProperty(getByTestId('preview-panel'), 'offsetWidth', {
      configurable: true,
      value: 500,
    });

    act(() => {
      fireEvent.pointerDown(handle, {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: 400,
      });
    });
    expect(document.body.style.cursor).toBe('col-resize');

    act(() => {
      window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
    });

    expect(document.body.style.userSelect).toBe('text');
    expect(document.body.style.cursor).toBe('default');
    expect(getHarness().getCol()).toBe('50%');
    expect(onPersist).not.toHaveBeenCalled();
    expect(getHarness().isResizing).toBe(false);
  });

  it('cancels on window blur and restores body styles', () => {
    const onPersist = vi.fn();
    document.body.style.userSelect = 'auto';
    document.body.style.cursor = '';
    const { getByTestId } = render(<Harness percent={40} onPersist={onPersist} />);
    const handle = getByTestId('resize-handle');
    Object.defineProperty(getByTestId('preview-panel'), 'offsetWidth', {
      configurable: true,
      value: 400,
    });

    act(() => {
      fireEvent.pointerDown(handle, {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: 400,
      });
    });

    act(() => {
      window.dispatchEvent(new Event('blur'));
    });

    expect(document.body.style.userSelect).toBe('auto');
    expect(document.body.style.cursor).toBe('');
    expect(getHarness().getCol()).toBe('40%');
    expect(onPersist).not.toHaveBeenCalled();
  });

  it('cleans up on unmount without leaving overlay', () => {
    const onPersist = vi.fn();
    const { getByTestId, unmount } = render(
      <Harness percent={50} onPersist={onPersist} />,
    );
    const handle = getByTestId('resize-handle');
    Object.defineProperty(getByTestId('preview-panel'), 'offsetWidth', {
      configurable: true,
      value: 500,
    });

    act(() => {
      fireEvent.pointerDown(handle, {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: 400,
      });
    });

    unmount();
    expect(document.querySelector('body > div[style*="z-index: 9999"]')).toBeNull();
    expect(document.body.style.cursor).not.toBe('col-resize');
  });

  it('adjusts by 1% with arrow keys helper and clamps to 30–70', () => {
    const onPersist = vi.fn();
    const { result } = renderHook(() => useSplitPanelResize(50, onPersist));

    act(() => {
      result.current.adjustPreviewPercent(1);
    });
    expect(onPersist).toHaveBeenLastCalledWith(51);

    act(() => {
      result.current.adjustPreviewPercent(100);
    });
    expect(onPersist).toHaveBeenLastCalledWith(70);

    act(() => {
      result.current.adjustPreviewPercent(-100);
    });
    expect(onPersist).toHaveBeenLastCalledWith(30);
  });
});
