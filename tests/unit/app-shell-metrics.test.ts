import { describe, expect, it } from 'vitest';
import {
  SIDEBAR_FULL_COLLAPSED_RAIL,
  SIDEBAR_PREFERRED_WIDTH_STAGE1,
  SHELL_CARD_GAP_PX,
  computeAppShellSnapshot,
  computeToastLayoutOffsetPx,
  resolveHasSidebar,
} from '@/lib/app-shell-metrics';

describe('resolveHasSidebar', () => {
  it('returns false for settings and auth shells', () => {
    expect(resolveHasSidebar('/settings')).toBe(false);
    expect(resolveHasSidebar('/settings/general')).toBe(false);
    expect(resolveHasSidebar('/login')).toBe(false);
    expect(resolveHasSidebar('/setup')).toBe(false);
    expect(resolveHasSidebar('/setup/gateway')).toBe(false);
    expect(resolveHasSidebar('/sprite')).toBe(false);
    expect(resolveHasSidebar('/float-icon')).toBe(false);
  });

  it('returns true for main app routes', () => {
    expect(resolveHasSidebar('/')).toBe(true);
    expect(resolveHasSidebar('/workflow')).toBe(true);
    expect(resolveHasSidebar('/my-tasks')).toBe(true);
  });
});

describe('computeAppShellSnapshot', () => {
  it('provincial expanded => preferred (default 260)', () => {
    const s = computeAppShellSnapshot({
      pathname: '/',
      layoutVariant: 'provincial',
      userCollapsed: false,
      contextCollapsed: false,
      effectiveSidebarMax: 400,
    });
    expect(s.effectiveSidebarWidth).toBe(SIDEBAR_PREFERRED_WIDTH_STAGE1);
    expect(s.effectiveCollapsed).toBe(false);
    expect(s.hasSidebar).toBe(true);
  });

  it('clamps display to effectiveMax without changing preferred', () => {
    const s = computeAppShellSnapshot({
      pathname: '/',
      layoutVariant: 'provincial',
      userCollapsed: false,
      contextCollapsed: false,
      preferredWidth: 336,
      effectiveSidebarMax: 300,
    });
    expect(s.sidebarPreferredWidth).toBe(336);
    expect(s.effectiveSidebarWidth).toBe(300);
  });

  it('provincial user collapsed => 0', () => {
    const s = computeAppShellSnapshot({
      pathname: '/',
      layoutVariant: 'provincial',
      userCollapsed: true,
      contextCollapsed: false,
      effectiveSidebarMax: 400,
    });
    expect(s.effectiveSidebarWidth).toBe(0);
    expect(s.effectiveCollapsed).toBe(true);
    expect(s.canUserRestoreSidebar).toBe(true);
  });

  it('provincial context collapsed => 0 without user restore', () => {
    const s = computeAppShellSnapshot({
      pathname: '/',
      layoutVariant: 'provincial',
      userCollapsed: false,
      contextCollapsed: true,
      effectiveSidebarMax: 400,
    });
    expect(s.effectiveSidebarWidth).toBe(0);
    expect(s.collapseReasons.context).toBe(true);
    expect(s.collapseReasons.user).toBe(false);
    expect(s.canUserRestoreSidebar).toBe(false);
  });

  it('user + context stays collapsed after context clears via reasons', () => {
    const during = computeAppShellSnapshot({
      pathname: '/',
      layoutVariant: 'provincial',
      userCollapsed: true,
      contextCollapsed: true,
      effectiveSidebarMax: 400,
    });
    expect(during.effectiveSidebarWidth).toBe(0);
    expect(during.canUserRestoreSidebar).toBe(false);

    const after = computeAppShellSnapshot({
      pathname: '/',
      layoutVariant: 'provincial',
      userCollapsed: true,
      contextCollapsed: false,
      effectiveSidebarMax: 400,
    });
    expect(after.effectiveSidebarWidth).toBe(0);
    expect(after.canUserRestoreSidebar).toBe(true);
  });

  it('covers user/viewport/context eight combinations', () => {
    const combos: Array<[boolean, boolean, boolean]> = [
      [false, false, false],
      [true, false, false],
      [false, true, false],
      [false, false, true],
      [true, true, false],
      [true, false, true],
      [false, true, true],
      [true, true, true],
    ];
    for (const [user, viewport, context] of combos) {
      const s = computeAppShellSnapshot({
        pathname: '/',
        layoutVariant: 'provincial',
        userCollapsed: user,
        contextCollapsed: context,
        viewportCollapsed: viewport,
        preferredWidth: 300,
        effectiveSidebarMax: viewport ? 100 : 400,
      });
      const collapsed = user || viewport || context;
      expect(s.effectiveCollapsed).toBe(collapsed);
      expect(s.effectiveSidebarWidth).toBe(collapsed ? 0 : 300);
      expect(s.collapseReasons).toEqual({ user, viewport, context });
      expect(s.canUserRestoreSidebar).toBe(user && !viewport && !context);
    }
  });

  it('full collapsed => 72', () => {
    const s = computeAppShellSnapshot({
      pathname: '/',
      layoutVariant: 'full',
      userCollapsed: true,
      contextCollapsed: false,
      effectiveSidebarMax: 400,
    });
    expect(s.effectiveSidebarWidth).toBe(SIDEBAR_FULL_COLLAPSED_RAIL);
  });

  it('settings => hasSidebar false / width 0', () => {
    const s = computeAppShellSnapshot({
      pathname: '/settings/general',
      layoutVariant: 'provincial',
      userCollapsed: false,
      contextCollapsed: false,
      effectiveSidebarMax: 400,
    });
    expect(s.hasSidebar).toBe(false);
    expect(s.effectiveSidebarWidth).toBe(0);
    expect(s.effectiveCollapsed).toBe(false);
  });
});

describe('computeToastLayoutOffsetPx', () => {
  it('uses effective width + provincial gap, never invents 72 for provincial', () => {
    const expanded = computeAppShellSnapshot({
      pathname: '/',
      layoutVariant: 'provincial',
      userCollapsed: false,
      contextCollapsed: false,
      effectiveSidebarMax: 400,
    });
    expect(computeToastLayoutOffsetPx(expanded)).toBe(
      SIDEBAR_PREFERRED_WIDTH_STAGE1 + SHELL_CARD_GAP_PX,
    );

    const collapsed = computeAppShellSnapshot({
      pathname: '/',
      layoutVariant: 'provincial',
      userCollapsed: true,
      contextCollapsed: false,
      effectiveSidebarMax: 400,
    });
    expect(computeToastLayoutOffsetPx(collapsed)).toBe(SHELL_CARD_GAP_PX);

    const settings = computeAppShellSnapshot({
      pathname: '/settings',
      layoutVariant: 'provincial',
      userCollapsed: false,
      contextCollapsed: false,
      effectiveSidebarMax: 400,
    });
    expect(computeToastLayoutOffsetPx(settings)).toBe(0);

    const fullCollapsed = computeAppShellSnapshot({
      pathname: '/',
      layoutVariant: 'full',
      userCollapsed: true,
      contextCollapsed: false,
      effectiveSidebarMax: 400,
    });
    expect(computeToastLayoutOffsetPx(fullCollapsed)).toBe(SIDEBAR_FULL_COLLAPSED_RAIL);
  });
});
