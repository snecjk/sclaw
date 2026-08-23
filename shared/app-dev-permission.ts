/**
 * Apollo-backed permission for the app-dev (建站) feature.
 * Key: claw.app.dev.whitelist.users
 */

export const APP_DEV_WHITELIST_USERS_KEY = 'claw.app.dev.whitelist.users';

export interface AppDevPermissionUser {
  userName?: string | null;
  code?: string | null;
  empCode?: string | null;
}

function normalizeWhitelistToken(value: string): string {
  return value.trim().toLowerCase();
}

export function parseAppDevWhitelistUsers(
  value: string | string[] | Set<string> | null | undefined,
): string[] {
  if (!value) return [];
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (value instanceof Set) {
    return Array.from(value)
      .map((item) => String(item).trim())
      .filter(Boolean);
  }
  return value
    .map((item) => String(item).trim())
    .filter(Boolean);
}

export function collectAppDevUserIdentifiers(user: AppDevPermissionUser | null | undefined): string[] {
  if (!user) return [];
  return [user.userName, user.code, user.empCode]
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

/**
 * Returns true only when whitelist is loaded, non-empty, and matches the user.
 * Null/empty whitelist means no access (fail-closed rollout).
 */
export function isAppDevUserWhitelisted(
  user: AppDevPermissionUser | null | undefined,
  whitelist: string[] | Set<string> | null | undefined,
): boolean {
  if (!whitelist) return false;
  const entries = whitelist instanceof Set ? Array.from(whitelist) : whitelist;
  if (entries.length === 0) return false;

  const allowed = new Set(entries.map(normalizeWhitelistToken));
  const identifiers = collectAppDevUserIdentifiers(user).map(normalizeWhitelistToken);
  return identifiers.some((identifier) => allowed.has(identifier));
}
