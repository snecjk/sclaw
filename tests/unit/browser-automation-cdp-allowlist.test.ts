import { describe, expect, it } from 'vitest';
import {
  CDP_RAW_CALL_ALLOWLIST,
  cdpMethodTimeoutMs,
  isCdpMethodAllowed,
} from '../../shared/browser-automation/cdp-allowlist';

describe('CDP 裸调白名单', () => {
  it('表内方法放行并带超时', () => {
    expect(isCdpMethodAllowed('Runtime.evaluate')).toBe(true);
    expect(cdpMethodTimeoutMs('Runtime.evaluate')).toBe(CDP_RAW_CALL_ALLOWLIST['Runtime.evaluate'].timeoutMs);
    expect(cdpMethodTimeoutMs('DOM.getBoxModel')).toBe(5_000);
  });

  it('负例：表外方法 → CDP_METHOD_NOT_ALLOWED', () => {
    expect(isCdpMethodAllowed('Page.navigate')).toBe(false);
    expect(isCdpMethodAllowed('Network.setCookie')).toBe(false);
    expect(isCdpMethodAllowed('Input.dispatchMouseEvent')).toBe(false);
    try {
      cdpMethodTimeoutMs('Page.navigate');
      throw new Error('expected throw');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('CDP_METHOD_NOT_ALLOWED');
    }
  });
});
