import { describe, expect, it } from 'vitest';
import { computeCrmWeekReportSurfaceAllowed } from '../../shared/crm-week-report-policy';

describe('computeCrmWeekReportSurfaceAllowed', () => {
  it('returns false when ssoUserName is empty', () => {
    expect(computeCrmWeekReportSurfaceAllowed('', { data: [{ userCode: 'x' }] })).toBe(false);
    expect(computeCrmWeekReportSurfaceAllowed(undefined, { data: [{ userCode: 'x' }] })).toBe(false);
  });

  it('matches after trim on both sides', () => {
    const payload = { data: [{ userCode: ' 1205314\n' }] };
    expect(computeCrmWeekReportSurfaceAllowed(' 1205314 ', payload)).toBe(true);
  });

  it('is case-sensitive', () => {
    expect(computeCrmWeekReportSurfaceAllowed('abc', { data: [{ userCode: 'ABC' }] })).toBe(false);
  });

  it('returns false when data is not an array', () => {
    expect(computeCrmWeekReportSurfaceAllowed('1', { data: {} as unknown })).toBe(false);
    expect(computeCrmWeekReportSurfaceAllowed('1', {})).toBe(false);
  });

  it('returns false when no userCode matches', () => {
    expect(
      computeCrmWeekReportSurfaceAllowed('1205314', {
        data: [{ userCode: '999' }, { jobnumber: '1205314' }],
      }),
    ).toBe(false);
  });
});
