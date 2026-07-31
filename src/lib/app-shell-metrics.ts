/**
 * AppShell layout metrics — pure helpers for sidebar effective width / toast offset.
 *
 * Stage 2: preferred width is user-resizable; effectiveMax clamps display;
 * viewport collapse is derived when effectiveMax < 200.
 * `sidebarCollapsed` store key means user reason only.
 */

import {
  CLOSED_WORKSPACE_MIN,
  SHELL_FRAME_HORIZONTAL_PX,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  clampSidebarPreferredWidth,
  computeEffectiveSidebarMax,
  shouldViewportCollapseSidebar,
} from '@/lib/sidebar-resize-metrics';

export const SIDEBAR_PREFERRED_WIDTH_STAGE1 = SIDEBAR_DEFAULT_WIDTH;
export const SIDEBAR_FULL_COLLAPSED_RAIL = 72;
export const SHELL_CARD_GAP_PX = 8;

export type AppShellLayoutVariant = 'provincial' | 'full';

export interface AppShellCollapseReasons {
  /** Persisted preference (`settings.sidebarCollapsed`) */
  user: boolean;
  /** Ephemeral — window too narrow for min sidebar */
  viewport: boolean;
  /** Ephemeral (e.g. workflow editor); must not write user preference */
  context: boolean;
}

export interface AppShellLayoutSnapshot {
  hasSidebar: boolean;
  layoutVariant: AppShellLayoutVariant;
  sidebarPreferredWidth: number;
  effectiveSidebarWidth: number;
  effectiveSidebarMax: number;
  effectiveCollapsed: boolean;
  collapseReasons: AppShellCollapseReasons;
  canUserRestoreSidebar: boolean;
}

export interface ComputeAppShellSnapshotInput {
  pathname: string;
  layoutVariant: AppShellLayoutVariant;
  /** User reason only — existing `sidebarCollapsed` key */
  userCollapsed: boolean;
  contextCollapsed: boolean;
  viewportCollapsed?: boolean;
  preferredWidth?: number;
  /** Dynamic max from viewport; defaults to SIDEBAR_MAX when omitted */
  effectiveSidebarMax?: number;
  viewportWidth?: number;
}

/**
 * Routes that must report hasSidebar=false / effectiveWidth=0
 * (login, setup, sprite, float-icon, settings).
 */
export function resolveHasSidebar(pathname: string): boolean {
  if (pathname.startsWith('/settings')) return false;
  if (pathname === '/login' || pathname.startsWith('/login/')) return false;
  if (pathname === '/setup' || pathname.startsWith('/setup/')) return false;
  if (pathname === '/sprite' || pathname.startsWith('/sprite/')) return false;
  if (pathname === '/float-icon' || pathname.startsWith('/float-icon/')) return false;
  return true;
}

export function collapsedTrackWidth(layoutVariant: AppShellLayoutVariant): number {
  return layoutVariant === 'provincial' ? 0 : SIDEBAR_FULL_COLLAPSED_RAIL;
}

export function resolveEffectiveSidebarMaxForViewport(
  viewportWidth: number,
  workspaceRequiredWidth: number = CLOSED_WORKSPACE_MIN,
): number {
  return computeEffectiveSidebarMax({
    viewportWidth,
    shellFrameWidth: SHELL_FRAME_HORIZONTAL_PX,
    workspaceRequiredWidth,
    absoluteMax: SIDEBAR_MAX_WIDTH,
  });
}

export function computeAppShellSnapshot(input: ComputeAppShellSnapshotInput): AppShellLayoutSnapshot {
  const preferredWidth = clampSidebarPreferredWidth(
    input.preferredWidth ?? SIDEBAR_DEFAULT_WIDTH,
  );
  const effectiveSidebarMax = Math.max(
    0,
    input.effectiveSidebarMax
      ?? (input.viewportWidth != null
        ? resolveEffectiveSidebarMaxForViewport(input.viewportWidth)
        : SIDEBAR_MAX_WIDTH),
  );

  const viewport =
    input.viewportCollapsed ?? shouldViewportCollapseSidebar(effectiveSidebarMax);

  const collapseReasons: AppShellCollapseReasons = {
    user: input.userCollapsed,
    viewport,
    context: input.contextCollapsed,
  };
  const effectiveCollapsed =
    collapseReasons.user || collapseReasons.viewport || collapseReasons.context;
  const hasSidebar = resolveHasSidebar(input.pathname);
  const layoutVariant = input.layoutVariant;

  let effectiveSidebarWidth = 0;
  if (hasSidebar) {
    effectiveSidebarWidth = effectiveCollapsed
      ? collapsedTrackWidth(layoutVariant)
      : Math.min(preferredWidth, effectiveSidebarMax);
  }

  return {
    hasSidebar,
    layoutVariant,
    sidebarPreferredWidth: preferredWidth,
    effectiveSidebarWidth,
    effectiveSidebarMax,
    effectiveCollapsed: hasSidebar ? effectiveCollapsed : false,
    collapseReasons,
    canUserRestoreSidebar:
      hasSidebar && collapseReasons.user && !collapseReasons.context && !collapseReasons.viewport,
  };
}

/**
 * Horizontal offset for Toaster center relative to viewport center.
 * Provincial always includes the 8px L0 gap/frame when a sidebar shell is present.
 */
export function computeToastLayoutOffsetPx(snapshot: AppShellLayoutSnapshot): number {
  if (!snapshot.hasSidebar) return 0;
  const gap = snapshot.layoutVariant === 'provincial' ? SHELL_CARD_GAP_PX : 0;
  return snapshot.effectiveSidebarWidth + gap;
}

export function formatCssPx(value: number): string {
  return `${value}px`;
}
