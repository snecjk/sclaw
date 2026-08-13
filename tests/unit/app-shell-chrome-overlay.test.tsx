import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AppShellChromeOverlay,
  SHELL_FALLBACK_DRAG_STRIP_HEIGHT_PX,
} from '@/components/layout/app-shell-chrome-overlay';

vi.mock('@/hooks/use-windows-chrome-owner', () => ({
  useWindowsChromeOwner: () => 'shell-fallback',
}));

afterEach(() => {
  window.electron.platform = 'darwin';
});

describe('AppShellChromeOverlay shell fallback', () => {
  it('renders a shallow drag strip on macOS without Windows controls', () => {
    window.electron.platform = 'darwin';
    render(<AppShellChromeOverlay />);

    const strip = document.querySelector<HTMLElement>('[data-slot="shell-fallback-drag-strip"]');
    expect(strip).not.toBeNull();
    expect(strip!).toHaveClass('drag-region');
    expect(strip!).toHaveStyle({ height: `${SHELL_FALLBACK_DRAG_STRIP_HEIGHT_PX}px` });
    expect(SHELL_FALLBACK_DRAG_STRIP_HEIGHT_PX).toBeLessThanOrEqual(8);
    expect(document.querySelector('[data-slot="windows-window-controls"]')).toBeNull();
  });

  it('keeps Windows controls outside the drag strip', () => {
    window.electron.platform = 'win32';
    render(<AppShellChromeOverlay />);

    const strip = document.querySelector<HTMLElement>('[data-slot="shell-fallback-drag-strip"]');
    const controls = document.querySelector('[data-slot="windows-window-controls"]');
    expect(strip).not.toBeNull();
    expect(controls).not.toBeNull();
    expect(strip!.contains(controls)).toBe(false);
    expect(controls).toHaveClass('no-drag');
  });
});
