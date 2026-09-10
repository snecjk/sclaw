import { describe, expect, it, vi } from 'vitest';
import { getOrCreateCdpSession, pressKeyViaCdp, valuesMatch, assertElementActionable } from '../../electron/services/browser-automation/input';
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

  it('B7.3 fill 前 disabled/readonly 前置检查', () => {
    expect(() => assertElementActionable({ found: true, disabled: true }, 'fill')).toThrow(/disabled/);
    expect(() => assertElementActionable({ found: true, readonly: true }, 'fill')).toThrow(/readonly/);
    expect(() => assertElementActionable({ found: true, readonly: true }, 'click')).not.toThrow();
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

describe('browser automation key definitions', () => {
  function createRecordingCdp() {
    const sent: Array<{ method: string; params: Record<string, unknown> }> = [];
    const cdp = {
      send: vi.fn(async (method: string, params: Record<string, unknown>) => {
        sent.push({ method, params });
        return {};
      }),
    } as unknown as BrowserAutomationCdpSession;
    return { cdp, sent };
  }

  it('R13 回归：End 键 windowsVirtualKeyCode=35，Home=36', async () => {
    const { cdp, sent } = createRecordingCdp();

    await pressKeyViaCdp(cdp, 'End');
    const endDown = sent.find(
      (call) => call.method === 'Input.dispatchKeyEvent' && call.params.type === 'keyDown',
    );
    expect(endDown?.params.key).toBe('End');
    expect(endDown?.params.windowsVirtualKeyCode).toBe(35);
    expect(endDown?.params.nativeVirtualKeyCode).toBe(35);

    sent.length = 0;
    await pressKeyViaCdp(cdp, 'Home');
    const homeDown = sent.find(
      (call) => call.method === 'Input.dispatchKeyEvent' && call.params.type === 'keyDown',
    );
    expect(homeDown?.params.windowsVirtualKeyCode).toBe(36);
  });
});
