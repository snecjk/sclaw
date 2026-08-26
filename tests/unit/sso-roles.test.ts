import { describe, expect, it } from 'vitest';
import {
  AI_MEMORY_CENTER_SYSTEM_ADMIN_ROLE,
  hasSystemAdminRole,
  normalizeSsoRoleCodes,
} from '../../shared/sso-roles';

describe('normalizeSsoRoleCodes', () => {
  it('returns empty array for non-array input', () => {
    expect(normalizeSsoRoleCodes(null)).toEqual([]);
    expect(normalizeSsoRoleCodes(undefined)).toEqual([]);
    expect(normalizeSsoRoleCodes('role')).toEqual([]);
  });

  it('normalizes string roles', () => {
    expect(normalizeSsoRoleCodes([' AI_MEMORY_CENTER_system_admin ', 'other'])).toEqual([
      'AI_MEMORY_CENTER_system_admin',
      'other',
    ]);
  });

  it('normalizes object roles with Code or roleCode', () => {
    expect(
      normalizeSsoRoleCodes([
        { Code: 'AI_MEMORY_CENTER_system_admin' },
        { roleCode: 'other_role' },
      ]),
    ).toEqual(['AI_MEMORY_CENTER_system_admin', 'other_role']);
  });
});

describe('hasSystemAdminRole', () => {
  it('returns true when system admin role is present', () => {
    expect(hasSystemAdminRole([AI_MEMORY_CENTER_SYSTEM_ADMIN_ROLE])).toBe(true);
  });

  it('returns false when roles are missing or empty', () => {
    expect(hasSystemAdminRole([])).toBe(false);
    expect(hasSystemAdminRole(undefined)).toBe(false);
    expect(hasSystemAdminRole(['other_role'])).toBe(false);
  });
});
