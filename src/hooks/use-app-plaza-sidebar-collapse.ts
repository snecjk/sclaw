import { useEffect, useRef } from 'react';
import { useAppShellLayout } from '@/components/layout/app-shell-layout-context';
import { useSettingsStore } from '@/stores/settings';

/**
 * Collapse the main sidebar while viewing a specific App Plaza app
 * (not the plaza home catalog). Leaving the app restores the previous preference.
 */
export function useAppPlazaSidebarCollapse(viewingApp: boolean): void {
  const { setUserCollapsed } = useAppShellLayout();
  const previousUserCollapsedRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (viewingApp) {
      if (previousUserCollapsedRef.current === null) {
        previousUserCollapsedRef.current = useSettingsStore.getState().sidebarCollapsed;
        setUserCollapsed(true);
      }
      return;
    }
    const previous = previousUserCollapsedRef.current;
    previousUserCollapsedRef.current = null;
    if (previous !== null && useSettingsStore.getState().sidebarCollapsed !== previous) {
      setUserCollapsed(previous);
    }
  }, [viewingApp, setUserCollapsed]);
}
