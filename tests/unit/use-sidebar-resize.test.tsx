// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarResizeHandle } from '@/components/layout/sidebar-resize-handle';
import { useSidebarResize } from '@/hooks/use-sidebar-resize';

function Harness({
  onCommitWidth,
  onCommitCollapse,
  preferredWidth = 260,
  effectiveMax = 400,
}: {
  onCommitWidth: (w: number) => void;
  onCommitCollapse: () => void;
  preferredWidth?: number;
  effectiveMax?: number;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(preferredWidth);
  const { isResizing, startResize, adjustWidthByKeyboard } = useSidebarResize({
    shellRef,
    preferredWidth,
    effectiveMax,
    effectiveWidth: width,
    onCommitWidth: (next) => {
      setWidth(next);
      onCommitWidth(next);
    },
    onCommitCollapse,
  });

  return (
    <div ref={shellRef} data-testid="shell" style={{ width: 1280, height: 640 }}>
      <SidebarResizeHandle
        valueNow={width}
        ariaValueMin={200}
        ariaValueMax={effectiveMax}
        isResizing={isResizing}
        onResizeStart={startResize}
        onKeyboardKey={adjustWidthByKeyboard}
      />
    </div>
  );
}

describe('useSidebarResize', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  it('pointermove writes CSS var without committing store until pointerup', () => {
    const onCommitWidth = vi.fn();
    const onCommitCollapse = vi.fn();
    render(
      <Harness onCommitWidth={onCommitWidth} onCommitCollapse={onCommitCollapse} />,
    );

    const handle = screen.getByRole('separator');
    const shell = screen.getByTestId('shell');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 260, button: 0 });
    expect(onCommitWidth).not.toHaveBeenCalled();

    fireEvent.pointerMove(window, { pointerId: 1, clientX: 320 });
    expect(shell.style.getPropertyValue('--sto-sidebar-effective-w')).toBe('320px');
    expect(onCommitWidth).not.toHaveBeenCalled();

    fireEvent.pointerUp(window, { pointerId: 1, clientX: 320 });
    expect(onCommitWidth).toHaveBeenCalledTimes(1);
    expect(onCommitWidth).toHaveBeenCalledWith(320);
    expect(onCommitCollapse).not.toHaveBeenCalled();
  });

  it('commits collapse at raw <= 176 and preserves preferred via not calling onCommitWidth', () => {
    const onCommitWidth = vi.fn();
    const onCommitCollapse = vi.fn();
    render(
      <Harness
        preferredWidth={260}
        onCommitWidth={onCommitWidth}
        onCommitCollapse={onCommitCollapse}
      />,
    );

    const handle = screen.getByRole('separator');
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 260, button: 0 });
    // 260 + (76 - 260) = 76 ≤ 176
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 76 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 76 });

    expect(onCommitCollapse).toHaveBeenCalledTimes(1);
    expect(onCommitWidth).not.toHaveBeenCalled();
  });

  it('cancel (pointercancel) restores preDrag and does not commit', () => {
    const onCommitWidth = vi.fn();
    const onCommitCollapse = vi.fn();
    render(
      <Harness
        preferredWidth={260}
        onCommitWidth={onCommitWidth}
        onCommitCollapse={onCommitCollapse}
      />,
    );

    const handle = screen.getByRole('separator');
    const shell = screen.getByTestId('shell');
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 260, button: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300 });
    fireEvent.pointerCancel(window, { pointerId: 1 });

    expect(onCommitWidth).not.toHaveBeenCalled();
    expect(onCommitCollapse).not.toHaveBeenCalled();
    expect(shell.style.getPropertyValue('--sto-sidebar-effective-w')).toBe('260px');
  });

  it('keyboard Arrow/Home/End commits preferred once per key', () => {
    const onCommitWidth = vi.fn();
    render(
      <Harness preferredWidth={260} onCommitWidth={onCommitWidth} onCommitCollapse={vi.fn()} />,
    );
    const handle = screen.getByRole('separator');
    act(() => {
      handle.focus();
    });
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(onCommitWidth).toHaveBeenLastCalledWith(252);
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(onCommitWidth).toHaveBeenLastCalledWith(200);
    fireEvent.keyDown(handle, { key: 'End' });
    expect(onCommitWidth).toHaveBeenLastCalledWith(400);
  });

  it('exposes aria min/max/now on separator', () => {
    render(
      <Harness preferredWidth={280} effectiveMax={360} onCommitWidth={vi.fn()} onCommitCollapse={vi.fn()} />,
    );
    const handle = screen.getByRole('separator');
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-valuemin')).toBe('200');
    expect(handle.getAttribute('aria-valuemax')).toBe('360');
    expect(handle.getAttribute('aria-valuenow')).toBe('280');
  });
});
