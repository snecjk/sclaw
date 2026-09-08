import { describe, expect, it } from 'vitest';
import { checkBrowserBridgeExtensionCompatibility } from '../../shared/browser-bridge/version';

describe('browser bridge extension version pairing', () => {
  it('treats missing installed version as compatible with update available', () => {
    expect(checkBrowserBridgeExtensionCompatibility(undefined, '1.2.0')).toEqual({
      compatible: true,
      updateAvailable: true,
      reason: 'extension version not reported',
    });
  });

  it('rejects major mismatch', () => {
    const result = checkBrowserBridgeExtensionCompatibility('2.0.0', '1.4.0');
    expect(result.compatible).toBe(false);
    expect(result.updateAvailable).toBe(true);
    expect(result.reason).toMatch(/major mismatch/);
  });

  it('flags minor/patch difference as updateAvailable', () => {
    expect(checkBrowserBridgeExtensionCompatibility('1.2.0', '1.4.1')).toMatchObject({
      compatible: true,
      updateAvailable: true,
    });
    expect(checkBrowserBridgeExtensionCompatibility('1.4.1', '1.4.1')).toMatchObject({
      compatible: true,
      updateAvailable: false,
    });
  });
});
