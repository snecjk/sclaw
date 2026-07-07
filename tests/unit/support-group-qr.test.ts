import { describe, expect, it } from 'vitest';
import {
  SUPPORT_GROUP_QR_URL_HQ,
  SUPPORT_GROUP_QR_URL_SITE,
  resolveSupportGroupQrUrl,
} from '../../shared/support-group-qr';

describe('resolveSupportGroupQrUrl', () => {
  it('returns site QR URL for site users', () => {
    expect(resolveSupportGroupQrUrl(true)).toBe(SUPPORT_GROUP_QR_URL_SITE);
  });

  it('returns HQ QR URL for non-site users', () => {
    expect(resolveSupportGroupQrUrl(false)).toBe(SUPPORT_GROUP_QR_URL_HQ);
  });
});
