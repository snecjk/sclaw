import { describe, expect, it } from 'vitest';
import { getOrCreateCdpSession, valuesMatch } from '../../electron/services/browser-automation/input';
import { BrowserAutomationCdpSession } from '../../electron/services/browser-automation/cdp-session';
import { buildObserveScript } from '../../shared/browser-automation/observe-script';

describe('browser automation input helpers', () => {
  it('getOrCreateCdpSession constructs CDP session at runtime', () => {
    const cache = new Map<number, BrowserAutomationCdpSession>();
    const webContents = { id: 42 } as import('electron').WebContents;
    const session = getOrCreateCdpSession(webContents, cache);
    expect(session).toBeInstanceOf(BrowserAutomationCdpSession);
    expect(getOrCreateCdpSession(webContents, cache)).toBe(session);
  });

  it('matches exact and partial typed values', () => {
    expect(valuesMatch('Sclaw浏览器自动化', 'Sclaw浏览器自动化')).toBe(true);
    expect(valuesMatch('前缀 Sclaw浏览器自动化 后缀', 'Sclaw浏览器自动化')).toBe(true);
    expect(valuesMatch('  hello  ', 'hello')).toBe(true);
    expect(valuesMatch('', '')).toBe(true);
  });

  it('rejects mismatched typed values', () => {
    expect(valuesMatch('', 'Sclaw浏览器自动化')).toBe(false);
    expect(valuesMatch('other', 'Sclaw浏览器自动化')).toBe(false);
  });
});

describe('browser automation observe script input helpers', () => {
  it('exposes CDP input helper functions', () => {
    const script = buildObserveScript(10);
    expect(script).toContain('resolveTargetForInput');
    expect(script).toContain('readTargetInputValue');
    expect(script).toContain('nativeFillTarget');
    expect(script).toContain('fillWithNativeSetter');
  });
});
