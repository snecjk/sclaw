import { describe, expect, it } from 'vitest';
import {
  getSclawWebBridgeChromeWebStoreUrl,
  parseSclawWebBridgeChromeWebStoreUrl,
} from '../../shared/browser-bridge/chrome-web-store';

describe('SClaw Web Bridge Chrome Web Store URL', () => {
  it('rejects empty and non-store URLs', () => {
    expect(parseSclawWebBridgeChromeWebStoreUrl('')).toBeNull();
    expect(parseSclawWebBridgeChromeWebStoreUrl('http://chromewebstore.google.com/detail/x')).toBeNull();
    expect(parseSclawWebBridgeChromeWebStoreUrl('https://example.com/detail/x')).toBeNull();
  });

  it('accepts Chrome Web Store https detail URLs', () => {
    expect(
      parseSclawWebBridgeChromeWebStoreUrl('https://chromewebstore.google.com/detail/sclaw-web-bridge/abcdefghijklmnop'),
    ).toBe('https://chromewebstore.google.com/detail/sclaw-web-bridge/abcdefghijklmnop');
  });

  it('keeps the bundled listing URL empty until publish', () => {
    expect(getSclawWebBridgeChromeWebStoreUrl()).toBeNull();
  });
});
