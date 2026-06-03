/**
 * Skill version normalization and comparison for STO marketplace / plaza.
 * Handles semver-like strings and platform formats such as V1_0_0.
 */

export const DEFAULT_SKILL_VERSION = '1.0.0';

export function normalizeSkillVersion(version: string | null | undefined): string | null {
  if (version === null || version === undefined) return null;
  let v = String(version).trim();
  if (!v) return null;

  v = v.replace(/^[vV]/, '');

  // V1_0_0 or 1_0_0 → 1.0.0
  if (/^\d+(_\d+)+$/.test(v)) {
    v = v.replace(/_/g, '.');
  }

  const match = v.match(/(\d+(?:\.\d+)*)/);
  return match ? match[1] : v;
}

export function compareSkillVersions(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const na = normalizeSkillVersion(a);
  const nb = normalizeSkillVersion(b);
  if (!na && !nb) return 0;
  if (!na) return -1;
  if (!nb) return 1;

  const pa = na.split('.').map((part) => parseInt(part, 10) || 0);
  const pb = nb.split('.').map((part) => parseInt(part, 10) || 0);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

/** True when remote is strictly newer than local (aggressive: missing local → 1.0.0). */
export function isRemoteVersionNewer(
  remote: string | null | undefined,
  local: string | null | undefined,
): boolean {
  const normalizedRemote = normalizeSkillVersion(remote);
  if (!normalizedRemote) return false;

  const normalizedLocal = normalizeSkillVersion(local) ?? DEFAULT_SKILL_VERSION;
  return compareSkillVersions(normalizedRemote, normalizedLocal) > 0;
}

/** Resolve local version for compare: lock → SKILL.md → default 1.0.0 (aggressive). */
export function resolveInstalledVersionForCompare(
  lockVersion: string | null | undefined,
  skillMdVersion: string | null | undefined,
): string {
  return (
    normalizeSkillVersion(lockVersion)
    ?? normalizeSkillVersion(skillMdVersion)
    ?? DEFAULT_SKILL_VERSION
  );
}
