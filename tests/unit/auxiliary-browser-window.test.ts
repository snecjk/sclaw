import { describe, expect, it } from 'vitest';
import { isAuxiliaryBrowserWindowUrl } from '../../electron/utils/auxiliary-browser-window';

describe('isAuxiliaryBrowserWindowUrl', () => {
  it('matches sprite, float-icon, and app-dev-ide hash routes', () => {
    expect(isAuxiliaryBrowserWindowUrl('http://localhost:5173/#/sprite')).toBe(true);
    expect(isAuxiliaryBrowserWindowUrl('file:///tmp/index.html#/float-icon')).toBe(true);
    expect(isAuxiliaryBrowserWindowUrl('file:///tmp/index.html#/app-dev-ide/ws-1')).toBe(true);
  });

  it('does not match the main chat window', () => {
    expect(isAuxiliaryBrowserWindowUrl('http://localhost:5173/#/')).toBe(false);
    expect(isAuxiliaryBrowserWindowUrl('http://localhost:5173/#/settings')).toBe(false);
    expect(isAuxiliaryBrowserWindowUrl('file:///tmp/index.html#/more-apps')).toBe(false);
  });
});
