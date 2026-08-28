/**
 * AppShellLayoutProvider — shared sidebar/shell snapshot for Routes + Toaster.
 *
 * Does not introduce layout DOM. User collapse authority remains
 * `settings.sidebarCollapsed` (interpreted as user reason only).
 * Stage 2: preferred width + single viewport observer for viewport reason.
 */
/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { useLocation } from 'react-router-dom';
import {
  computeAppShellSnapshot,
  resolveEffectiveSidebarMaxForViewport,
  type AppShellLayoutSnapshot,
} from '@/lib/app-shell-metrics';
import {
  CLOSED_WORKSPACE_MIN,
  clampSidebarPreferredWidth,
  shouldViewportCollapseSidebar,
} from '@/lib/sidebar-resize-metrics';
import { getSidebarLayoutVariant } from '@/lib/sidebar-layout';
import { useSettingsStore } from '@/stores/settings';
import { useWorkflowUiStore } from '@/stores/workflow-ui';

export interface AppShellLayoutContextValue {
  snapshot: AppShellLayoutSnapshot;
  /** Writes user reason only (persisted sidebarCollapsed) */
  setUserCollapsed: (collapsed: boolean) => void;
  /** Writes preferred width only (persisted sidebarPreferredWidth) */
  setPreferredWidth: (width: number) => void;
  /** Writes preview context reason only (ephemeral, never persisted) */
  setPreviewContextCollapsed: Dispatch<SetStateAction<boolean>>;
}

const AppShellLayoutContext = createContext<AppShellLayoutContextValue | null>(null);

function readViewportWidth(): number {
  if (typeof window === 'undefined') return 1280;
  return window.innerWidth;
}

export function AppShellLayoutProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const userCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);
  const preferredWidth = useSettingsStore((s) => s.sidebarPreferredWidth);
  const setSidebarPreferredWidth = useSettingsStore((s) => s.setSidebarPreferredWidth);
  const workflowEditorCollapsed = useWorkflowUiStore((s) => s.editorActive);
  const layoutVariant = getSidebarLayoutVariant();

  const [viewportWidth, setViewportWidth] = useState(readViewportWidth);
  const [previewContextCollapsed, setPreviewContextCollapsed] = useState(false);
  const contextCollapsed = workflowEditorCollapsed || previewContextCollapsed;

  useEffect(() => {
    const onResize = () => {
      setViewportWidth(readViewportWidth());
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Stage 2: PreviewMode not implemented — use closed workspace minimum.
  const effectiveSidebarMax = resolveEffectiveSidebarMaxForViewport(
    viewportWidth,
    CLOSED_WORKSPACE_MIN,
  );
  const viewportCollapsed = shouldViewportCollapseSidebar(effectiveSidebarMax);

  const snapshot = computeAppShellSnapshot({
    pathname,
    layoutVariant,
    userCollapsed,
    contextCollapsed,
    viewportCollapsed,
    preferredWidth,
    effectiveSidebarMax,
    viewportWidth,
  });

  const value: AppShellLayoutContextValue = {
    snapshot,
    setUserCollapsed: setSidebarCollapsed,
    setPreferredWidth: (width: number) => {
      setSidebarPreferredWidth(clampSidebarPreferredWidth(width));
    },
    setPreviewContextCollapsed,
  };

  return (
    <AppShellLayoutContext.Provider value={value}>
      {children}
    </AppShellLayoutContext.Provider>
  );
}

export function useAppShellLayout(): AppShellLayoutContextValue {
  const ctx = useContext(AppShellLayoutContext);
  if (!ctx) {
    throw new Error('useAppShellLayout must be used within AppShellLayoutProvider');
  }
  return ctx;
}

/** Optional consumer when Provider may be absent in isolated tests */
export function useAppShellLayoutOptional(): AppShellLayoutContextValue | null {
  return useContext(AppShellLayoutContext);
}
