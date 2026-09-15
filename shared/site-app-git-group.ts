/**
 * Site App Git Group binding for first source commit / repository provision.
 * group_type + group_code are derived from SSO session identity.
 */

import { getSiteDepartmentTypes, isSiteUser } from './site-user-utils';

export type SiteAppGitGroupType = 'site' | 'department' | 'headquarters';

export interface SiteAppGitGroupParams {
  groupType: SiteAppGitGroupType;
  groupCode: string;
}

/** categoryCode values that mean headquarters (总部整体). */
const HEADQUARTERS_CATEGORY_CODES = new Set(['总公司', '总部']);

/**
 * Fallback site keywords when Apollo site-department types are not loaded yet.
 * Keep in sync with electron/services/sto-sk-strategy.ts SITE_KEYWORDS.
 */
const SITE_CATEGORY_FALLBACK_KEYWORDS = ['承包区', '独立网点', '网点部门', '丹鸟加盟站点'];

function isSiteCategory(categoryCode: string): boolean {
  if (isSiteUser(categoryCode)) return true;
  const types = getSiteDepartmentTypes();
  if (types && types.size > 0) return false;
  return SITE_CATEGORY_FALLBACK_KEYWORDS.some((keyword) => categoryCode.includes(keyword));
}

function isHeadquartersCategory(categoryCode: string): boolean {
  const trimmed = categoryCode.trim();
  if (HEADQUARTERS_CATEGORY_CODES.has(trimmed)) return true;
  return trimmed.includes('总公司') || trimmed.includes('总部');
}

/**
 * Map SSO user to Git Group binding params.
 * - site（网点）→ companyCode
 * - headquarters（总部）→ companyCode
 * - department（省区/管理区等）→ companyCode
 */
export function resolveSiteAppGitGroup(user: {
  categoryCode?: string | null;
  companyCode?: string | null;
}): SiteAppGitGroupParams | null {
  const categoryCode = typeof user.categoryCode === 'string' ? user.categoryCode.trim() : '';
  const groupCode = typeof user.companyCode === 'string' ? user.companyCode.trim() : '';
  if (!categoryCode || !groupCode) return null;

  if (isSiteCategory(categoryCode)) {
    return { groupType: 'site', groupCode };
  }
  if (isHeadquartersCategory(categoryCode)) {
    return { groupType: 'headquarters', groupCode };
  }
  return { groupType: 'department', groupCode };
}
