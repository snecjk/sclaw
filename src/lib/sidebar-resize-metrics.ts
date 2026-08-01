/**
 * Sidebar resize metrics — pure clamp / snap / collapse / effectiveMax helpers.
 *
 * Stage 2 engineering baseline (MCP 区域 5 / Node 48:16806 aligned):
 * min 200 · default 260 · max 400 · collapse at 176 (200 − 24).
 */

export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_DEFAULT_WIDTH = 260;
export const SIDEBAR_MAX_WIDTH = 400;
/** rawWidth ≤ this commits user collapsed (200 − 24). */
export const SIDEBAR_COLLAPSE_THRESHOLD = 176;

/** Provincial shell horizontal frame: Workspace right frame only (8px).
 * The resize hit area is an overlay and no longer consumes a Grid track.
 */
export const SHELL_FRAME_HORIZONTAL_PX = 8;

/** Stage 0 approved — Preview closed (Stage 2 default page constraint). */
export const CLOSED_WORKSPACE_MIN = 560;
export const SPLIT_CHAT_MIN = 480;
export const SPLIT_PREVIEW_MIN = 560;
export const EXPANDED_PREVIEW_MIN = 640;

export const SIDEBAR_KEYBOARD_STEP = 8;
export const SIDEBAR_KEYBOARD_STEP_LARGE = 32;

/** Snap hysteresis (engineering baseline; MCP had no hysteresis numbers). */
export const SNAP_DEFAULT_ENTER = 6;
export const SNAP_DEFAULT_EXIT = 12;
export const SNAP_MIN_ENTER = 8;
export const SNAP_MIN_EXIT = 14;

export type SidebarSnapTarget = 'none' | 'min' | 'default';

export type WorkspacePreviewModeConstraint = 'closed' | 'split' | 'expanded';

export function clampSidebarPreferredWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

export function resolveWorkspaceRequiredWidth(
  mode: WorkspacePreviewModeConstraint = 'closed',
): number {
  if (mode === 'split') return SPLIT_CHAT_MIN + SPLIT_PREVIEW_MIN;
  if (mode === 'expanded') return EXPANDED_PREVIEW_MIN;
  return CLOSED_WORKSPACE_MIN;
}

export function computeEffectiveSidebarMax(input: {
  viewportWidth: number;
  shellFrameWidth?: number;
  workspaceRequiredWidth?: number;
  absoluteMax?: number;
}): number {
  const shell = input.shellFrameWidth ?? SHELL_FRAME_HORIZONTAL_PX;
  const required = input.workspaceRequiredWidth ?? CLOSED_WORKSPACE_MIN;
  const absoluteMax = input.absoluteMax ?? SIDEBAR_MAX_WIDTH;
  const fromViewport = input.viewportWidth - shell - required;
  return Math.min(absoluteMax, Math.max(0, Math.floor(fromViewport)));
}

export function shouldViewportCollapseSidebar(effectiveMax: number): boolean {
  return effectiveMax < SIDEBAR_MIN_WIDTH;
}

/**
 * Apply 200/260 snap with enter/exit hysteresis.
 * Operates on raw pointer width before hard clamp to [min, effectiveMax].
 */
export function applySidebarSnapHysteresis(
  rawWidth: number,
  previousTarget: SidebarSnapTarget,
): { snappedWidth: number; snapTarget: SidebarSnapTarget } {
  let snapTarget = previousTarget;

  if (snapTarget === 'default' && Math.abs(rawWidth - SIDEBAR_DEFAULT_WIDTH) > SNAP_DEFAULT_EXIT) {
    snapTarget = 'none';
  } else if (snapTarget === 'min' && Math.abs(rawWidth - SIDEBAR_MIN_WIDTH) > SNAP_MIN_EXIT) {
    snapTarget = 'none';
  }

  if (snapTarget === 'none') {
    if (Math.abs(rawWidth - SIDEBAR_DEFAULT_WIDTH) <= SNAP_DEFAULT_ENTER) {
      snapTarget = 'default';
    } else if (Math.abs(rawWidth - SIDEBAR_MIN_WIDTH) <= SNAP_MIN_ENTER) {
      snapTarget = 'min';
    }
  }

  if (snapTarget === 'default') {
    return { snappedWidth: SIDEBAR_DEFAULT_WIDTH, snapTarget };
  }
  if (snapTarget === 'min') {
    return { snappedWidth: SIDEBAR_MIN_WIDTH, snapTarget };
  }
  return { snappedWidth: rawWidth, snapTarget };
}

/** Display width while dragging: never below 200, never above effectiveMax. */
export function clampSidebarRenderedWidth(width: number, effectiveMax: number): number {
  const max = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, effectiveMax));
  return Math.min(max, Math.max(SIDEBAR_MIN_WIDTH, width));
}

export function shouldCommitSidebarCollapse(rawWidth: number): boolean {
  return rawWidth <= SIDEBAR_COLLAPSE_THRESHOLD;
}

export function resolveDragRenderedWidth(input: {
  rawWidth: number;
  snapTarget: SidebarSnapTarget;
  effectiveMax: number;
}): { renderedWidth: number; nextSnapTarget: SidebarSnapTarget } {
  const { snappedWidth, snapTarget } = applySidebarSnapHysteresis(
    input.rawWidth,
    input.snapTarget,
  );
  return {
    renderedWidth: clampSidebarRenderedWidth(snappedWidth, input.effectiveMax),
    nextSnapTarget: snapTarget,
  };
}

export function resolveKeyboardSidebarWidth(input: {
  current: number;
  effectiveMax: number;
  key: string;
  shiftKey: boolean;
}): number | null {
  const max = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, input.effectiveMax));
  const step = input.shiftKey ? SIDEBAR_KEYBOARD_STEP_LARGE : SIDEBAR_KEYBOARD_STEP;

  if (input.key === 'ArrowLeft') {
    return clampSidebarRenderedWidth(input.current - step, max);
  }
  if (input.key === 'ArrowRight') {
    return clampSidebarRenderedWidth(input.current + step, max);
  }
  if (input.key === 'Home') {
    return SIDEBAR_MIN_WIDTH;
  }
  if (input.key === 'End') {
    return max;
  }
  return null;
}
