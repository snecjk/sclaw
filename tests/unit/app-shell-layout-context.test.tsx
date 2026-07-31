import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import {
  AppShellLayoutProvider,
  useAppShellLayout,
} from '@/components/layout/app-shell-layout-context';
import { useSettingsStore } from '@/stores/settings';
import { useWorkflowUiStore } from '@/stores/workflow-ui';
import { SIDEBAR_PREFERRED_WIDTH_STAGE1 } from '@/lib/app-shell-metrics';

function Probe() {
  const { snapshot } = useAppShellLayout();
  const location = useLocation();
  return (
    <div
      data-testid="app-shell-probe"
      data-path={location.pathname}
      data-width={String(snapshot.effectiveSidebarWidth)}
      data-collapsed={snapshot.effectiveCollapsed ? '1' : '0'}
      data-user={snapshot.collapseReasons.user ? '1' : '0'}
      data-context={snapshot.collapseReasons.context ? '1' : '0'}
      data-has-sidebar={snapshot.hasSidebar ? '1' : '0'}
    />
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppShellLayoutProvider>
        <Probe />
      </AppShellLayoutProvider>
    </MemoryRouter>,
  );
}

describe('AppShellLayoutProvider', () => {
  beforeEach(() => {
    useSettingsStore.setState({ sidebarCollapsed: false, sidebarPreferredWidth: 260 });
    useWorkflowUiStore.setState({ editorActive: false });
    vi.stubEnv('VITE_STOCLAW_SIDEBAR_LAYOUT', 'provincial');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it('exposes provincial expanded width 260 on home', () => {
    renderAt('/');
    const probe = screen.getByTestId('app-shell-probe');
    expect(probe.getAttribute('data-width')).toBe(String(SIDEBAR_PREFERRED_WIDTH_STAGE1));
    expect(probe.getAttribute('data-collapsed')).toBe('0');
  });

  it('applies user collapse from settings store', () => {
    useSettingsStore.setState({ sidebarCollapsed: true });
    renderAt('/');
    const probe = screen.getByTestId('app-shell-probe');
    expect(probe.getAttribute('data-width')).toBe('0');
    expect(probe.getAttribute('data-user')).toBe('1');
    expect(probe.getAttribute('data-collapsed')).toBe('1');
  });

  it('applies context collapse without flipping user reason', () => {
    useWorkflowUiStore.setState({ editorActive: true });
    renderAt('/');
    const probe = screen.getByTestId('app-shell-probe');
    expect(probe.getAttribute('data-width')).toBe('0');
    expect(probe.getAttribute('data-context')).toBe('1');
    expect(probe.getAttribute('data-user')).toBe('0');
    expect(useSettingsStore.getState().sidebarCollapsed).toBe(false);
  });

  it('settings reports hasSidebar=0 and width 0', () => {
    renderAt('/settings/general');
    const probe = screen.getByTestId('app-shell-probe');
    expect(probe.getAttribute('data-has-sidebar')).toBe('0');
    expect(probe.getAttribute('data-width')).toBe('0');
  });
});
