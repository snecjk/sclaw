import { describe, expect, it } from 'vitest';
import {
  getStoPolicyHybridApiHostForAppEnv,
  getStoPolicyHybridApiHostForSsoEnv,
  getStoPolicyReportApiHostForAppEnv,
} from '../../shared/env-config';

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
describe('getStoPolicyHybridApiHostForAppEnv', () => {
  it('maps development and test to zc-hybrid-test', () => {
    expect(getStoPolicyHybridApiHostForAppEnv('development')).toBe('zc-hybrid-test.sto.cn');
    expect(getStoPolicyHybridApiHostForAppEnv('test')).toBe('zc-hybrid-test.sto.cn');
  });

  it('maps staging to pre-zc-hybrid', () => {
    expect(getStoPolicyHybridApiHostForAppEnv('staging')).toBe('pre-zc-hybrid.sto.cn');
  });

  it('maps production to zc-hybrid', () => {
    expect(getStoPolicyHybridApiHostForAppEnv('production')).toBe('zc-hybrid.sto.cn');
  });
});

describe('getStoPolicyHybridApiHostForSsoEnv', () => {
  it('maps daily/local SSO to test hybrid', () => {
    expect(getStoPolicyHybridApiHostForSsoEnv('daily-external')).toBe('zc-hybrid-test.sto.cn');
    expect(getStoPolicyHybridApiHostForSsoEnv('local')).toBe('zc-hybrid-test.sto.cn');
  });

  it('maps pre-release SSO to staging hybrid', () => {
    expect(getStoPolicyHybridApiHostForSsoEnv('pre-release')).toBe('pre-zc-hybrid.sto.cn');
  });

  it('maps production SSO to prod hybrid even when the app is DEV', () => {
    expect(getStoPolicyHybridApiHostForSsoEnv('production-external')).toBe('zc-hybrid.sto.cn');
    expect(getStoPolicyHybridApiHostForSsoEnv('production-internal')).toBe('zc-hybrid.sto.cn');
  });
});

