import { afterEach, describe, expect, it } from 'vitest';
import {
  getBrowserAutomationLevel,
  isBrowserAutomationEnabled,
  parseBrowserAutomationLevel,
  setBrowserAutomationSettingsLevel,
} from '../../shared/browser-automation/feature-flag';

describe('browser automation master switch', () => {
  afterEach(() => {
    delete process.env.STOCLAW_BROWSER_AUTOMATION;
    delete process.env.VITE_STOCLAW_BROWSER_AUTOMATION;
    setBrowserAutomationSettingsLevel(null);
  });

  it('parses off/dom/ax tokens', () => {
    expect(parseBrowserAutomationLevel('off')).toBe('off');
    expect(parseBrowserAutomationLevel('DOM')).toBe('dom');
    expect(parseBrowserAutomationLevel('false')).toBe('off');
    expect(parseBrowserAutomationLevel('ax')).toBe('ax');
    expect(parseBrowserAutomationLevel(1)).toBeNull();
  });

  it('lets env override injected settings', () => {
    setBrowserAutomationSettingsLevel('ax');
    process.env.STOCLAW_BROWSER_AUTOMATION = 'off';
    expect(getBrowserAutomationLevel()).toBe('off');
    expect(isBrowserAutomationEnabled()).toBe(false);
  });

  it('uses injected settings when env is empty', () => {
    setBrowserAutomationSettingsLevel('off');
    expect(getBrowserAutomationLevel()).toBe('off');
    expect(isBrowserAutomationEnabled()).toBe(false);
    setBrowserAutomationSettingsLevel('dom');
    expect(isBrowserAutomationEnabled()).toBe(true);
  });
});
