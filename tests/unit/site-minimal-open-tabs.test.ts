import { describe, expect, it } from 'vitest';
import {
  closeOpenTab,
  ensureOpenTab,
} from '../../resources/app-templates/site-minimal/src/layouts/open-tab-state';
import { getOpenTabPresentation } from '../../resources/app-templates/site-minimal/src/layouts/OpenTabs';

describe('site-minimal OpenTabs state', () => {
  it('keeps home open and does not add the same page twice', () => {
    expect(ensureOpenTab(['home'], 'example')).toEqual(['home', 'example']);
    expect(ensureOpenTab(['home', 'example'], 'example')).toEqual(['home', 'example']);
  });

  it('closes the active tab by selecting the right neighbor first', () => {
    expect(closeOpenTab(['home', 'orders', 'reports'], 'orders', 'orders')).toEqual({
      openPaths: ['home', 'reports'],
      nextPath: 'reports',
    });
  });

  it('uses the left neighbor then home when closing the active tab', () => {
    expect(closeOpenTab(['home', 'orders'], 'orders', 'orders')).toEqual({
      openPaths: ['home'],
      nextPath: 'home',
    });
    expect(closeOpenTab(['home'], 'home', 'home')).toEqual({
      openPaths: ['home'],
      nextPath: 'home',
    });
  });

  it('removing an inactive tab preserves the active page', () => {
    expect(closeOpenTab(['home', 'orders', 'reports'], 'orders', 'reports')).toEqual({
      openPaths: ['home', 'reports'],
      nextPath: 'reports',
    });
  });

  it('uses the first authorized page as the pinned tab instead of hard-coded home', () => {
    expect(ensureOpenTab([], 'reports', 'dashboard')).toEqual(['dashboard', 'reports']);
    expect(closeOpenTab(
      ['dashboard', 'reports'],
      'dashboard',
      'dashboard',
      'dashboard',
    )).toEqual({
      openPaths: ['dashboard', 'reports'],
      nextPath: 'dashboard',
    });
    expect(closeOpenTab(
      ['dashboard', 'reports'],
      'reports',
      'reports',
      'dashboard',
    )).toEqual({
      openPaths: ['dashboard'],
      nextPath: 'dashboard',
    });
  });

  it('does not apply compact home styling to a non-home pinned page', () => {
    expect(getOpenTabPresentation('reports', 'reports')).toEqual({
      isHome: false,
      isPinned: true,
    });
    expect(getOpenTabPresentation('home', 'reports')).toEqual({
      isHome: true,
      isPinned: false,
    });
  });
});
