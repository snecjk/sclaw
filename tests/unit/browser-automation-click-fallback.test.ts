// @vitest-environment node
/**
 * 波次 2 · B7 click 降级链（计划 §七 browser-automation-click-fallback.test.ts）：
 * - JS 成功 via:'js'
 * - 遮挡 → CDP 坐标降级 via:'cdp'
 * - 负例：探针未命中 → CLICK_NOT_DELIVERED 且附 occluder
 */
import { describe, expect, it, vi } from 'vitest';
import { actClickWithFallback } from '../../electron/services/browser-automation/input';
import type { BrowserAutomationCdpSession } from '../../electron/services/browser-automation/cdp-session';

function createCdp() {
  const send = vi.fn(async () => ({}));
  return { cdp: { send } as unknown as BrowserAutomationCdpSession, send };
}

describe('actClickWithFallback', () => {
  it('JS 成功：via js，探针命中目标链', async () => {
    const { cdp, send } = createCdp();
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes('window.__stoBrowserAutomation.installClickProbe(')) return true;
      if (script.includes('window.__stoBrowserAutomation.readClickProbe(')) {
        return { delivered: true, targetMatched: true };
      }
      if (script.includes('window.__stoBrowserAutomation.act(')) {
        return { success: true, action: 'click', ref: '@e1', stableKey: 'k1' };
      }
      return null;
    });

    const result = await actClickWithFallback({
      cdp,
      executeJavaScript,
      payload: { action: 'click', ref: '@e1' },
      probeWindowMs: 0,
    });

    expect(result.success).toBe(true);
    expect(result.via).toBe('js');
    expect(result.probeDelivered).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('遮挡 → CDP 降级：via cdp 且探针确认投递', async () => {
    const { cdp, send } = createCdp();
    let probeReads = 0;
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes('window.__stoBrowserAutomation.installClickProbe(')) return true;
      if (script.includes('window.__stoBrowserAutomation.readClickProbe(')) {
        probeReads += 1;
        if (probeReads === 1) return { delivered: false, targetMatched: false };
        return { delivered: true, targetMatched: true };
      }
      if (script.includes('window.__stoBrowserAutomation.act(')) {
        return { success: true, occluded: true, occluder: 'div#modal', ref: '@e1', stableKey: 'k1' };
      }
      if (script.includes('window.__stoBrowserAutomation.resolveTargetForInput(')) {
        return { found: true, centerX: 40, centerY: 80, ref: '@e1', stableKey: 'k1' };
      }
      return null;
    });

    const result = await actClickWithFallback({
      cdp,
      executeJavaScript,
      payload: { action: 'click', ref: '@e1' },
      probeWindowMs: 0,
    });

    expect(result.success).toBe(true);
    expect(result.via).toBe('cdp');
    expect(result.occluded).toBe(true);
    expect(result.occluder).toBe('div#modal');
    expect(result.probeDelivered).toBe(true);
    expect(send).toHaveBeenCalled();
    expect(send.mock.calls.some((call) => call[0] === 'Input.dispatchMouseEvent')).toBe(true);
  });

  it('负例：CDP 投递后探针未命中 → CLICK_NOT_DELIVERED 且附 occluder', async () => {
    const { cdp } = createCdp();
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes('window.__stoBrowserAutomation.installClickProbe(')) return true;
      if (script.includes('window.__stoBrowserAutomation.readClickProbe(')) {
        return { delivered: true, targetMatched: false };
      }
      if (script.includes('window.__stoBrowserAutomation.act(')) {
        return { success: true, occluded: true, occluder: 'div.overlay', ref: '@e2', stableKey: 'k2' };
      }
      if (script.includes('window.__stoBrowserAutomation.resolveTargetForInput(')) {
        return { found: true, centerX: 12, centerY: 18, ref: '@e2', stableKey: 'k2' };
      }
      return null;
    });

    const result = await actClickWithFallback({
      cdp,
      executeJavaScript,
      payload: { action: 'click', ref: '@e2' },
      probeWindowMs: 0,
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('CLICK_NOT_DELIVERED');
    expect(result.via).toBe('cdp');
    expect(result.occluder).toBe('div.overlay');
    expect(result.probeDelivered).toBe(false);
  });

  it('mouse_click：跳过 JS click 直接 CDP', async () => {
    const { cdp, send } = createCdp();
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes('window.__stoBrowserAutomation.installClickProbe(')) return true;
      if (script.includes('window.__stoBrowserAutomation.readClickProbe(')) {
        return { delivered: true, targetMatched: true };
      }
      if (script.includes('window.__stoBrowserAutomation.resolveTargetForInput(')) {
        return { found: true, centerX: 5, centerY: 9, ref: '@e1', stableKey: 'k1' };
      }
      return { success: false, error: 'should not JS click' };
    });

    const result = await actClickWithFallback({
      cdp,
      executeJavaScript,
      payload: { action: 'mouse_click', ref: '@e1' },
      forceCdp: true,
      probeWindowMs: 0,
    });

    expect(result.success).toBe(true);
    expect(result.via).toBe('cdp');
    expect(executeJavaScript.mock.calls.some((call) =>
      String(call[0]).includes('window.__stoBrowserAutomation.act('),
    )).toBe(false);
    expect(send).toHaveBeenCalled();
  });
});
