import { beforeEach, describe, expect, it } from 'vitest';
import {
  getSiteDepartmentTypes,
  isSiteUser,
  setSiteDepartmentTypes,
} from '../../shared/site-user-utils';

describe('site-user-utils', () => {
  beforeEach(() => {
    setSiteDepartmentTypes(null);
  });

  it('returns false when categoryCode is empty', () => {
    setSiteDepartmentTypes(['独立网点', '承包区']);
    expect(isSiteUser(null)).toBe(false);
    expect(isSiteUser(undefined)).toBe(false);
    expect(isSiteUser('')).toBe(false);
  });

  it('returns false when site department types cache is empty', () => {
    expect(getSiteDepartmentTypes()).toBeNull();
    expect(isSiteUser('独立网点')).toBe(false);
  });

  it('returns true when categoryCode matches cached site type', () => {
    setSiteDepartmentTypes(['独立网点', '承包区']);
    expect(isSiteUser('独立网点')).toBe(true);
    expect(isSiteUser('  承包区  ')).toBe(true);
  });

  it('returns false when categoryCode does not match cached site type', () => {
    setSiteDepartmentTypes(['独立网点', '承包区']);
    expect(isSiteUser('总部')).toBe(false);
  });

  it('accepts comma-separated string for setSiteDepartmentTypes', () => {
    setSiteDepartmentTypes('独立网点, 承包区');
    expect(isSiteUser('承包区')).toBe(true);
    expect(isSiteUser('独立网点')).toBe(true);
  });
});
