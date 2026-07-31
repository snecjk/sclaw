import { describe, expect, it } from 'vitest';
import {
  SIDEBAR_COLLAPSE_THRESHOLD,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  applySidebarSnapHysteresis,
  clampSidebarPreferredWidth,
  clampSidebarRenderedWidth,
  computeEffectiveSidebarMax,
  resolveDragRenderedWidth,
  resolveKeyboardSidebarWidth,
  resolveWorkspaceRequiredWidth,
  shouldCommitSidebarCollapse,
  shouldViewportCollapseSidebar,
} from '@/lib/sidebar-resize-metrics';

describe('clampSidebarPreferredWidth', () => {
  it('clamps 199→200 and 401→400', () => {
    expect(clampSidebarPreferredWidth(199)).toBe(200);
    expect(clampSidebarPreferredWidth(401)).toBe(400);
    expect(clampSidebarPreferredWidth(336.6)).toBe(337);
  });
});

describe('snap hysteresis', () => {
  it('enters and exits 260 snap without boundary chatter', () => {
    const enter = applySidebarSnapHysteresis(260 + 6, 'none');
    expect(enter.snapTarget).toBe('default');
    expect(enter.snappedWidth).toBe(SIDEBAR_DEFAULT_WIDTH);

    const hold = applySidebarSnapHysteresis(260 + 10, 'default');
    expect(hold.snapTarget).toBe('default');
    expect(hold.snappedWidth).toBe(SIDEBAR_DEFAULT_WIDTH);

    const exit = applySidebarSnapHysteresis(260 + 13, 'default');
    expect(exit.snapTarget).toBe('none');
    expect(exit.snappedWidth).toBe(273);
  });

  it('enters and exits 200 snap without boundary chatter', () => {
    const enter = applySidebarSnapHysteresis(200 + 8, 'none');
    expect(enter.snapTarget).toBe('min');
    expect(enter.snappedWidth).toBe(SIDEBAR_MIN_WIDTH);

    const hold = applySidebarSnapHysteresis(200 + 12, 'min');
    expect(hold.snapTarget).toBe('min');

    const exit = applySidebarSnapHysteresis(200 + 15, 'min');
    expect(exit.snapTarget).toBe('none');
  });
});

describe('collapse threshold', () => {
  it('177 does not collapse; 176 collapses', () => {
    expect(shouldCommitSidebarCollapse(177)).toBe(false);
    expect(shouldCommitSidebarCollapse(176)).toBe(true);
    expect(SIDEBAR_COLLAPSE_THRESHOLD).toBe(176);
  });

  it('keeps rendered width at least 200 while raw is above collapse', () => {
    const next = resolveDragRenderedWidth({
      rawWidth: 180,
      snapTarget: 'none',
      effectiveMax: 400,
    });
    expect(next.renderedWidth).toBe(SIDEBAR_MIN_WIDTH);
  });
});

describe('effectiveMax / viewport', () => {
  it('uses Stage 0 closed workspace min and does not overwrite preferred math', () => {
    expect(resolveWorkspaceRequiredWidth('closed')).toBe(560);
    expect(resolveWorkspaceRequiredWidth('split')).toBe(1040);
    expect(resolveWorkspaceRequiredWidth('expanded')).toBe(640);

    const max = computeEffectiveSidebarMax({
      viewportWidth: 1280,
      shellFrameWidth: 16,
      workspaceRequiredWidth: 560,
    });
    expect(max).toBe(SIDEBAR_MAX_WIDTH);

    const narrow = computeEffectiveSidebarMax({
      viewportWidth: 900,
      shellFrameWidth: 16,
      workspaceRequiredWidth: 560,
    });
    expect(narrow).toBe(324);
    expect(shouldViewportCollapseSidebar(199)).toBe(true);
    expect(shouldViewportCollapseSidebar(200)).toBe(false);
  });

  it('clamps rendered to effectiveMax', () => {
    expect(clampSidebarRenderedWidth(400, 300)).toBe(300);
    expect(clampSidebarRenderedWidth(150, 300)).toBe(200);
  });
});

describe('keyboard', () => {
  it('Arrow / Shift / Home / End', () => {
    expect(
      resolveKeyboardSidebarWidth({
        current: 260,
        effectiveMax: 400,
        key: 'ArrowLeft',
        shiftKey: false,
      }),
    ).toBe(252);
    expect(
      resolveKeyboardSidebarWidth({
        current: 260,
        effectiveMax: 400,
        key: 'ArrowRight',
        shiftKey: true,
      }),
    ).toBe(292);
    expect(
      resolveKeyboardSidebarWidth({
        current: 336,
        effectiveMax: 380,
        key: 'Home',
        shiftKey: false,
      }),
    ).toBe(200);
    expect(
      resolveKeyboardSidebarWidth({
        current: 200,
        effectiveMax: 380,
        key: 'End',
        shiftKey: false,
      }),
    ).toBe(380);
  });
});
