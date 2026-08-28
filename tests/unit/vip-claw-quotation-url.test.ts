import { describe, expect, it } from 'vitest';
import {
  buildVipClawQuotationUrl,
  getVipClawQuotationHost,
  isVipClawQuotationUrl,
} from '../../shared/vip-claw-quotation-url';

describe('vip-claw-quotation-url', () => {
  it('picks host by environment', () => {
    expect(getVipClawQuotationHost('test')).toBe('https://wd-vip-test.sto.cn');
    expect(getVipClawQuotationHost('development')).toBe('https://wd-vip-test.sto.cn');
    expect(getVipClawQuotationHost('staging')).toBe('https://wd-vip-pre.sto.cn');
    expect(getVipClawQuotationHost('production')).toBe('https://wd-vip.sto.cn');
  });

  it('builds clawQuotation url with encoded ossKey', () => {
    const url = buildVipClawQuotationUrl('vip/osstmp/a b', 'test');
    expect(url).toBe('https://wd-vip-test.sto.cn/sclaw/clawQuotation?ossKey=vip%2Fosstmp%2Fa%20b');
    expect(isVipClawQuotationUrl(url)).toBe(true);
  });
});
