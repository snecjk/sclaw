import { describe, expect, it } from 'vitest';
import {
  closeOpenTab,
  ensureOpenTab,
} from '../../resources/app-templates/site-minimal/src/layouts/open-tab-state';

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
});
