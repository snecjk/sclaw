import { describe, expect, it } from 'vitest';
import { computeCrmWeekReportSurfaceAllowed } from '../../shared/crm-week-report-policy';

describe('computeCrmWeekReportSurfaceAllowed', () => {
  it('returns false when both ssoCode and ssoUserName are empty', () => {
    expect(computeCrmWeekReportSurfaceAllowed('', '', { data: [{ userCode: 'x' }] })).toBe(false);
    expect(computeCrmWeekReportSurfaceAllowed(undefined, undefined, { data: [{ userCode: 'x' }] })).toBe(false);
    expect(computeCrmWeekReportSurfaceAllowed(null, null, { data: [{ userCode: 'x' }] })).toBe(false);
  });

  it('returns false when ssoCode is empty and ssoUserName is empty/missing', () => {
    expect(computeCrmWeekReportSurfaceAllowed('', '', { data: [{ userCode: '1205314' }] })).toBe(false);
    expect(computeCrmWeekReportSurfaceAllowed(null, undefined, { data: [{ userCode: '1205314' }] })).toBe(false);
  });

  it('matches after trim on both sides via ssoCode', () => {
    const payload = { data: [{ userCode: ' 1205314\n' }] };
    expect(computeCrmWeekReportSurfaceAllowed(' 1205314 ', '', payload)).toBe(true);
  });

  it('matches after trim on both sides via ssoUserName (fallback)', () => {
    const payload = { data: [{ userCode: ' 1205314\n' }] };
    expect(computeCrmWeekReportSurfaceAllowed('', ' 1205314 ', payload)).toBe(true);
  });

  it('is case-sensitive for ssoCode', () => {
    expect(computeCrmWeekReportSurfaceAllowed('abc', '', { data: [{ userCode: 'ABC' }] })).toBe(false);
  });

  it('is case-sensitive for ssoUserName', () => {
    expect(computeCrmWeekReportSurfaceAllowed('', 'abc', { data: [{ userCode: 'ABC' }] })).toBe(false);
  });

  it('returns false when data is not an array', () => {
    expect(computeCrmWeekReportSurfaceAllowed('1', '1', { data: {} as unknown })).toBe(false);
    expect(computeCrmWeekReportSurfaceAllowed('1', '1', {})).toBe(false);
  });

  it('returns false when no userCode matches neither ssoCode nor ssoUserName', () => {
    expect(
      computeCrmWeekReportSurfaceAllowed('1205314', '1205314', {
        data: [{ userCode: '999' }, { jobnumber: '1205314' }],
      }),
    ).toBe(false);
  });

  it('prefers ssoCode over ssoUserName — code matches first', () => {
    const payload = { data: [{ userCode: 'CODE_VAL' }, { userCode: 'USER_VAL' }] };
    expect(computeCrmWeekReportSurfaceAllowed('CODE_VAL', 'USER_VAL', payload)).toBe(true);
  });

  it('falls back to ssoUserName when ssoCode does not match any userCode', () => {
    const payload = { data: [{ userCode: 'other' }, { userCode: '1205314' }] };
    expect(computeCrmWeekReportSurfaceAllowed('wrong-code', '1205314', payload)).toBe(true);
  });

  it('falls back to ssoUserName when ssoCode is empty', () => {
    const payload = { data: [{ userCode: '1205314' }] };
    expect(computeCrmWeekReportSurfaceAllowed('', '1205314', payload)).toBe(true);
    expect(computeCrmWeekReportSurfaceAllowed(null, '1205314', payload)).toBe(true);
  });

  it('returns false when ssoCode matches nothing and ssoUserName is empty', () => {
    const payload = { data: [{ userCode: '999' }] };
    expect(computeCrmWeekReportSurfaceAllowed('CODE_VAL', '', payload)).toBe(false);
    expect(computeCrmWeekReportSurfaceAllowed('CODE_VAL', null, payload)).toBe(false);
  });
});
