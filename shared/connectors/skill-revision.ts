/**
 * Generic connector skill package revision helpers (not product-specific).
 */

/** Prefer remote revision; install when missing or different. */
export function shouldUpdateSkillRevision(
  localRevision: string | null | undefined,
  remoteRevision: string | null | undefined,
): boolean {
  const local = (localRevision || '').trim();
  const remote = (remoteRevision || '').trim();
  if (!remote) return !local;
  if (!local) return true;
  return local !== remote;
}

/** Extract revision from Content-Disposition / URL filename. */
export function extractSkillRevisionFromFilename(filename: string): string | null {
  const base = filename.trim().split(/[/\\]/).pop() || '';
  const match =
    base.match(/qpath-cli-skill-main-([a-f0-9]{7,40})/i)
    || base.match(/-main-([a-f0-9]{7,40})(?:\.tar\.gz|\.tgz|\.zip)?$/i)
    || base.match(/-([a-f0-9]{40})(?:\.tar\.gz|\.tgz|\.zip)?$/i);
  return match?.[1] ?? null;
}
