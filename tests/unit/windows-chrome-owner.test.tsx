import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowsWindowControls } from '@/components/layout/windows-window-controls';
import { resolveWindowsChromeOwner } from '@/hooks/use-windows-chrome-owner';

const invokeIpcMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

beforeEach(() => {
  invokeIpcMock.mockReset();
  invokeIpcMock.mockResolvedValue(false);
});

describe('provincial Windows Chrome owner', () => {
  it('selects exactly one owner for each visible Chrome Surface', () => {
    expect(resolveWindowsChromeOwner({
      isProvincial: false,
      pathname: '/',
      browserOverlayOpen: false,
      appPlazaVisible: false,
    })).toBe('none');

    expect(resolveWindowsChromeOwner({
      isProvincial: true,
      pathname: '/',
      browserOverlayOpen: false,
      appPlazaVisible: false,
    })).toBe('content-header');

    expect(resolveWindowsChromeOwner({
      isProvincial: true,
      pathname: '/more-apps',
      browserOverlayOpen: false,
      appPlazaVisible: true,
    })).toBe('app-plaza');

    expect(resolveWindowsChromeOwner({
      isProvincial: true,
      pathname: '/settings',
      browserOverlayOpen: false,
      appPlazaVisible: false,
    })).toBe('shell-fallback');

    expect(resolveWindowsChromeOwner({
      isProvincial: true,
      pathname: '/skills',
      browserOverlayOpen: false,
      appPlazaVisible: false,
    })).toBe('shell-fallback');

    expect(resolveWindowsChromeOwner({
      isProvincial: true,
      pathname: '/my-tasks',
      browserOverlayOpen: false,
      appPlazaVisible: false,
    })).toBe('shell-fallback');

    expect(resolveWindowsChromeOwner({
      isProvincial: true,
      pathname: '/more-apps',
      browserOverlayOpen: true,
      appPlazaVisible: true,
    })).toBe('shell-fallback');
  });

  it('keeps controls inside the active drag Surface and removes reserve-node patches', () => {
    const headerSrc = readFileSync(
      resolve(process.cwd(), 'src/components/layout/ContentHeader.tsx'),
      'utf8',
    );
    const appPlazaSrc = readFileSync(
      resolve(process.cwd(), 'src/components/more-apps/AppPlazaTabStrip.tsx'),
      'utf8',
    );
    const fallbackSrc = readFileSync(
      resolve(process.cwd(), 'src/components/layout/app-shell-chrome-overlay.tsx'),
      'utf8',
    );
    const controlsSrc = readFileSync(
      resolve(process.cwd(), 'src/components/layout/windows-window-controls.tsx'),
      'utf8',
    );
    const surfacesSrc = readFileSync(resolve(process.cwd(), 'src/lib/surfaces.ts'), 'utf8');
    const appPlazaCss = readFileSync(
      resolve(process.cwd(), 'src/components/more-apps/app-plaza-shell.css'),
      'utf8',
    );

    expect(headerSrc).toContain("windowsChromeOwner === 'content-header'");
    expect(appPlazaSrc).toContain("windowsChromeOwner === 'app-plaza'");
    expect(fallbackSrc).toContain("chromeOwner !== 'shell-fallback'");
    expect(controlsSrc).toContain('data-slot="windows-window-controls"');
    expect(controlsSrc).toContain("window.electron?.platform === 'win32'");
    expect(controlsSrc).toContain("'no-drag flex shrink-0 items-center'");
    expect(controlsSrc).toContain("invokeIpc('window:minimize')");
    expect(controlsSrc).toContain("invokeIpc('window:maximize')");
    expect(controlsSrc).toContain("invokeIpc('window:close')");
    expect(controlsSrc).toContain('hover:bg-muted');
    expect(controlsSrc).toContain('hover:bg-destructive');
    expect(controlsSrc).not.toMatch(/bg-white|bg-black/);
    expect(headerSrc).not.toContain('winControlsReserve');
    expect(surfacesSrc).not.toContain('contentHeaderWinControlsReserveClass');
    expect(appPlazaCss).not.toContain('app-plaza-tabstrip__win-reserve');
  });
});

describe('shared Windows window controls', () => {
  it('keeps the three click paths inside one no-drag group', async () => {
    window.electron.platform = 'win32';
    render(<WindowsWindowControls />);

    const controls = screen.getByTitle('Minimize').closest(
      '[data-slot="windows-window-controls"]',
    );
    expect(controls).toHaveClass('no-drag');

    await waitFor(() => {
      expect(invokeIpcMock).toHaveBeenCalledWith('window:isMaximized');
    });
    invokeIpcMock.mockClear();

    fireEvent.click(screen.getByTitle('Minimize'));
    fireEvent.click(screen.getByTitle('Maximize'));
    fireEvent.click(screen.getByTitle('Close'));

    await waitFor(() => {
      expect(invokeIpcMock).toHaveBeenCalledWith('window:minimize');
      expect(invokeIpcMock).toHaveBeenCalledWith('window:maximize');
      expect(invokeIpcMock).toHaveBeenCalledWith('window:isMaximized');
      expect(invokeIpcMock).toHaveBeenCalledWith('window:close');
    });
  });

  it('does not render custom controls on macOS', () => {
    window.electron.platform = 'darwin';
    const { container } = render(<WindowsWindowControls />);

    expect(container).toBeEmptyDOMElement();
    expect(invokeIpcMock).not.toHaveBeenCalled();
  });
});
