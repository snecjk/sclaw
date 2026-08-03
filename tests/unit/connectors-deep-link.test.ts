import { describe, expect, it } from 'vitest';

import {
  isInAppNavigateHref,
  normalizeInAppNavigatePath,
  SKILL_PLAZA_CONNECTORS_HREF,
  SKILL_PLAZA_CONNECTORS_PATH,
} from '../../shared/connectors/deep-link';
import { resolvePreviewHrefAction } from '../../src/lib/preview-href';

describe('connector deep link', () => {
  it('recognizes plaza connectors path (hash + path)', () => {
    expect(SKILL_PLAZA_CONNECTORS_PATH).toBe('/skills?section=connectors');
    expect(SKILL_PLAZA_CONNECTORS_HREF).toBe('#/skills?section=connectors');
    expect(isInAppNavigateHref('/skills?section=connectors')).toBe(true);
    expect(isInAppNavigateHref('#/skills?section=connectors')).toBe(true);
    expect(isInAppNavigateHref('stoclaw://skills?section=connectors')).toBe(true);
    expect(isInAppNavigateHref('/tmp/foo')).toBe(false);
  });

  it('normalizes hash and stoclaw scheme to router path', () => {
    expect(normalizeInAppNavigatePath('#/skills?section=connectors')).toBe(
      '/skills?section=connectors',
    );
    expect(normalizeInAppNavigatePath('stoclaw://skills?section=connectors')).toBe(
      '/skills?section=connectors',
    );
  });

  it('resolves markdown href to navigate-app action', () => {
    expect(resolvePreviewHrefAction('#/skills?section=connectors')).toEqual({
      action: 'navigate-app',
      path: '/skills?section=connectors',
    });
    expect(resolvePreviewHrefAction('/skills?section=connectors')).toEqual({
      action: 'navigate-app',
      path: '/skills?section=connectors',
    });
  });
});
