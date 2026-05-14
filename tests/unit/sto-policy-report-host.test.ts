import { describe, expect, it } from 'vitest';
import { getStoPolicyReportApiHostForAppEnv } from '../../shared/env-config';

describe('getStoPolicyReportApiHostForAppEnv', () => {
  it('maps development and test to zc-test', () => {
    expect(getStoPolicyReportApiHostForAppEnv('development')).toBe('zc-test.sto.cn');
    expect(getStoPolicyReportApiHostForAppEnv('test')).toBe('zc-test.sto.cn');
  });

  it('maps staging to pre-zc', () => {
    expect(getStoPolicyReportApiHostForAppEnv('staging')).toBe('pre-zc.sto.cn');
  });

  it('maps production to zc', () => {
    expect(getStoPolicyReportApiHostForAppEnv('production')).toBe('zc.sto.cn');
  });
});
