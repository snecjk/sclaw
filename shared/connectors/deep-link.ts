/** In-app deep links for connector plaza (chat markdown + SkillPlaza query).
 * App uses HashRouter — prefer `#/skills?...` in markdown so a raw <a> still stays in SPA.
 */
export const SKILL_PLAZA_CONNECTORS_PATH = '/skills?section=connectors';
/** Safe to put in markdown href under HashRouter (avoids full page reload). */
export const SKILL_PLAZA_CONNECTORS_HREF = '#/skills?section=connectors';

export function isInAppNavigateHref(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed) return false;
  const withoutHash = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (withoutHash.startsWith('/skills')) return true;
  const lower = trimmed.toLowerCase();
  return lower.startsWith('stoclaw://skills');
}

/** Normalize chat href to a react-router path (pathname + search), no leading #. */
export function normalizeInAppNavigatePath(href: string): string {
  let trimmed = href.trim();
  if (!trimmed) return '/skills';
  if (trimmed.startsWith('#')) trimmed = trimmed.slice(1);
  if (trimmed.toLowerCase().startsWith('stoclaw://skills')) {
    const rest = trimmed.slice('stoclaw://skills'.length);
    return rest.startsWith('?') || rest.startsWith('/')
      ? `/skills${rest}`
      : `/skills${rest ? `?${rest}` : ''}`;
  }
  if (trimmed.startsWith('/')) return trimmed;
  return `/${trimmed}`;
}
