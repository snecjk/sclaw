import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  AppShellLayoutProvider,
} from '@/components/layout/app-shell-layout-context';
import { useAppPlazaSidebarCollapse } from '@/hooks/use-app-plaza-sidebar-collapse';
import { useSettingsStore } from '@/stores/settings';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <AppShellLayoutProvider>{children}</AppShellLayoutProvider>
    </MemoryRouter>
  );
}

describe('useAppPlazaSidebarCollapse', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_STOCLAW_SIDEBAR_LAYOUT', 'provincial');
    useSettingsStore.setState({ sidebarCollapsed: false, sidebarPreferredWidth: 260 });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it('collapses the sidebar when opening a specific app and restores on leave', () => {
    const { rerender } = renderHook(
      ({ viewingApp }: { viewingApp: boolean }) => useAppPlazaSidebarCollapse(viewingApp),
      { wrapper, initialProps: { viewingApp: false } },
    );

    expect(useSettingsStore.getState().sidebarCollapsed).toBe(false);

    rerender({ viewingApp: true });
    expect(useSettingsStore.getState().sidebarCollapsed).toBe(true);

    rerender({ viewingApp: false });
    expect(useSettingsStore.getState().sidebarCollapsed).toBe(false);
  });

  it('keeps the sidebar expanded on App Plaza home until an app is opened', () => {
    renderHook(
      ({ viewingApp }: { viewingApp: boolean }) => useAppPlazaSidebarCollapse(viewingApp),
      { wrapper, initialProps: { viewingApp: false } },
    );

    expect(useSettingsStore.getState().sidebarCollapsed).toBe(false);
  });

  it('does not expand a sidebar that was already collapsed before entering', () => {
    useSettingsStore.setState({ sidebarCollapsed: true });
    const { rerender } = renderHook(
      ({ viewingApp }: { viewingApp: boolean }) => useAppPlazaSidebarCollapse(viewingApp),
      { wrapper, initialProps: { viewingApp: false } },
    );

    rerender({ viewingApp: true });
    expect(useSettingsStore.getState().sidebarCollapsed).toBe(true);

    rerender({ viewingApp: false });
    expect(useSettingsStore.getState().sidebarCollapsed).toBe(true);
  });
});
