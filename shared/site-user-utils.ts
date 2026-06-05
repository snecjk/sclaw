/**
 * Shared site-user detection utilities.
 *
 * Site-user classification depends on the Apollo config key
 * `claw.site.department`.  The main process loads this config at login time
 * and the renderer syncs it via the host API.  Both sides share the same
 * in-memory cache (in their respective JS runtimes).
 */

let siteDepartmentTypes: Set<string> | null = null;

/**
 * Set the cached department types that identify a site user.
 * Accepts a comma-separated string, an array, or a Set.
 */
export function setSiteDepartmentTypes(
  types: string | string[] | Set<string> | null | undefined,
): void {
  if (!types) {
    siteDepartmentTypes = null;
    return;
  }
  if (typeof types === 'string') {
    siteDepartmentTypes = new Set(
      types
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    return;
  }
  siteDepartmentTypes = new Set(types);
}

/** Get the currently cached site department types. */
export function getSiteDepartmentTypes(): Set<string> | null {
  return siteDepartmentTypes;
}

/**
 * Check whether the given category code represents a site user.
 * Uses the cached Apollo config. Returns `false` when the cache is empty
 * (config not yet loaded) so callers should ensure the cache is warmed
 * before relying on the result.
 */
export function isSiteUser(categoryCode: string | null | undefined): boolean {
  if (!categoryCode) return false;
  const types = siteDepartmentTypes;
  if (!types || types.size === 0) return false;
  return types.has(categoryCode.trim());
}
